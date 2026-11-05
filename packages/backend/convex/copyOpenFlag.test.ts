import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";

// The denormalized `ownedPuzzles.isOpen` listing flag (PERF-B1m, SEC-29): every availability write
// keeps it equal to "at least one exchange-availability flag is set", and the one-shot backfill sets
// it on legacy rows and repairs any row whose flag disagrees with its availability.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type Avail = Doc<"ownedPuzzles">["availability"];
const CLOSED: Avail = { forTrade: false, forSale: false, forLend: false };
const NOW = 1_700_000_000_000;

const seedMembers = (t: TestConvex<typeof schema>) =>
  t.run(async (ctx) => {
    const mkUser = (clerkId: string) =>
      ctx.db.insert("users", {
        clerkId,
        email: `${clerkId}@example.com`,
        name: clerkId,
        isActive: true,
        createdAt: NOW,
        updatedAt: NOW,
      });
    const alice = await mkUser("clerk_alice");
    const bob = await mkUser("clerk_bob");
    const puzzleAggregateId = crypto.randomUUID();
    const puzzleId = await ctx.db.insert("puzzles", {
      aggregateId: puzzleAggregateId,
      title: "Mountain Vista",
      pieceCount: 1000,
      status: "approved",
      submittedBy: alice,
      createdAt: NOW,
      updatedAt: NOW,
    });
    return { alice, bob, puzzleId, puzzleAggregateId };
  });

const asAlice = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_alice" });
const asBob = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_bob" });

const rowByAggregate = (t: TestConvex<typeof schema>, aggregateId: string) =>
  t.run(async (ctx) =>
    ctx.db
      .query("ownedPuzzles")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", aggregateId))
      .unique(),
  );

describe("the copy repository keeps isOpen in step with availability", () => {
  test("a newly acquired copy is stored closed", async () => {
    const t = convexTest(schema, modules);
    const { puzzleAggregateId } = await seedMembers(t);
    const copyId = await asAlice(t).mutation(
      api.library.acquireCopy.acquireCopy,
      { puzzleDefinitionId: puzzleAggregateId, condition: "good" },
    );
    expect((await rowByAggregate(t, copyId))?.isOpen).toBe(false);
  });

  test("a batch item offered for swap is stored open", async () => {
    const t = convexTest(schema, modules);
    const { puzzleAggregateId } = await seedMembers(t);
    const { copyIds } = await asAlice(t).mutation(
      api.library.acquireCopies.acquireCopies,
      { items: [{ puzzleDefinitionId: puzzleAggregateId, forTrade: true }] },
    );
    expect((await rowByAggregate(t, copyIds[0]!))?.isOpen).toBe(true);
  });

  test("opening and closing a copy's sharing flips the flag both ways", async () => {
    const t = convexTest(schema, modules);
    const { puzzleAggregateId } = await seedMembers(t);
    const copyId = await asAlice(t).mutation(
      api.library.acquireCopy.acquireCopy,
      { puzzleDefinitionId: puzzleAggregateId, condition: "good" },
    );
    const share = (flags: Partial<Avail>) =>
      asAlice(t).mutation(api.library.updateCopySharing.updateCopySharing, {
        copyId,
        visibility: "visible",
        ...flags,
      });

    await share({ forLend: true });
    expect((await rowByAggregate(t, copyId))?.isOpen).toBe(true);
    await share({ forLend: false });
    expect((await rowByAggregate(t, copyId))?.isOpen).toBe(false);
  });

  test("a settled exchange takes the copy off the market and clears the flag", async () => {
    const t = convexTest(schema, modules);
    const { bob, puzzleId } = await seedMembers(t);
    const copy = await t.run((ctx) =>
      ctx.db.insert("ownedPuzzles", {
        puzzleId,
        ownerId: bob,
        condition: "good",
        availability: { ...CLOSED, forSale: true },
        isOpen: true,
        listedAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
      }),
    );
    const exchangeId = await asAlice(t).mutation(api.exchange.propose.propose, {
      recipientId: bob,
      type: "sale",
      requestedPuzzleId: copy,
      salePrice: 1000,
    });
    await asBob(t).mutation(api.exchange.accept.accept, { exchangeId });
    await asAlice(t).mutation(
      api.exchange.confirmCompletion.confirmCompletion,
      { exchangeId },
    );
    await asBob(t).mutation(api.exchange.confirmCompletion.confirmCompletion, {
      exchangeId,
    });
    const row = await t.run((ctx) => ctx.db.get(copy));
    expect(row?.availability).toEqual(CLOSED);
    expect(row?.isOpen).toBe(false);
    expect(row?.listedAt).toBeUndefined();
  });
});

describe("the listing fields Browse's candidate index reads", () => {
  const DAY = 24 * 60 * 60 * 1000;

  afterEach(() => {
    vi.useRealTimers();
  });

  const setPrivate = (t: TestConvex<typeof schema>, memberId: Id<"users">) =>
    t.run((ctx) =>
      ctx.db.insert("profiles", {
        memberId,
        visibility: "private",
        updatedAt: NOW,
      }),
    );

  const listing = async (t: TestConvex<typeof schema>, aggregateId: string) => {
    const row = await rowByAggregate(t, aggregateId);
    return {
      isOpen: row?.isOpen,
      listedAt: row?.listedAt,
      ownerPrivate: row?.ownerPrivate,
    };
  };

  test("a copy is listed when it opens and keeps that time while it stays open", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const t = convexTest(schema, modules);
    const { puzzleAggregateId } = await seedMembers(t);
    const copyId = await asAlice(t).mutation(
      api.library.acquireCopy.acquireCopy,
      { puzzleDefinitionId: puzzleAggregateId, condition: "good" },
    );
    const share = (flags: Partial<Avail>) =>
      asAlice(t).mutation(api.library.updateCopySharing.updateCopySharing, {
        copyId,
        visibility: "visible",
        ...flags,
      });
    expect(await listing(t, copyId)).toEqual({
      isOpen: false,
      listedAt: undefined,
      ownerPrivate: undefined,
    });

    vi.setSystemTime(NOW + DAY);
    await share({ forLend: true });
    expect((await listing(t, copyId)).listedAt).toBe(NOW + DAY);

    vi.setSystemTime(NOW + 2 * DAY);
    await share({ forLend: true, forTrade: true });
    expect((await listing(t, copyId)).listedAt).toBe(NOW + DAY);

    await share({});
    expect(await listing(t, copyId)).toEqual({
      isOpen: false,
      listedAt: undefined,
      ownerPrivate: undefined,
    });

    vi.setSystemTime(NOW + 3 * DAY);
    await share({ forTrade: true });
    expect((await listing(t, copyId)).listedAt).toBe(NOW + 3 * DAY);
  });

  test("a copy added open is listed when it was added; a private owner's is marked", async () => {
    const t = convexTest(schema, modules);
    const { alice, puzzleAggregateId } = await seedMembers(t);
    await setPrivate(t, alice);
    const { copyIds } = await asAlice(t).mutation(
      api.library.acquireCopies.acquireCopies,
      { items: [{ puzzleDefinitionId: puzzleAggregateId, forTrade: true }] },
    );
    const row = await rowByAggregate(t, copyIds[0]!);
    // Offered in the same call that added it.
    expect(row?.listedAt).toBeGreaterThanOrEqual(row!.createdAt);
    expect(row?.listedAt).toBeLessThan(row!.createdAt + 1000);
    expect(row?.ownerPrivate).toBe(true);
  });

  test("a profile visibility change moves every copy of the member between ranges", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const { puzzleAggregateId } = await seedMembers(t);
    const { copyIds: open } = await asAlice(t).mutation(
      api.library.acquireCopies.acquireCopies,
      { items: [{ puzzleDefinitionId: puzzleAggregateId, forTrade: true }] },
    );
    const closed = await asAlice(t).mutation(
      api.library.acquireCopy.acquireCopy,
      { puzzleDefinitionId: puzzleAggregateId, condition: "good" },
    );
    const copyIds = [...open, closed];
    const setVisibility = async (visibility: "public" | "private") => {
      await asAlice(t).mutation(
        api.social.setProfileVisibility.setProfileVisibility,
        { visibility },
      );
      await t.finishAllScheduledFunctions(vi.runAllTimers);
    };
    const flags = () =>
      Promise.all(
        copyIds.map(async (id) => (await listing(t, id)).ownerPrivate),
      );
    const listedAt = (await listing(t, copyIds[0]!)).listedAt;

    await setVisibility("private");
    expect(await flags()).toEqual([true, true]);
    await setVisibility("public");
    expect(await flags()).toEqual([undefined, undefined]);
    // Moving between ranges is not a new offer.
    expect((await listing(t, copyIds[0]!)).listedAt).toBe(listedAt);
  });

  test("a copy sold to a private member is marked for its new owner", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const { alice, bob, puzzleAggregateId } = await seedMembers(t);
    await setPrivate(t, alice);
    const { copyIds } = await asBob(t).mutation(
      api.library.acquireCopies.acquireCopies,
      { items: [{ puzzleDefinitionId: puzzleAggregateId, forTrade: true }] },
    );
    const copy = (await rowByAggregate(t, copyIds[0]!))!;
    expect(copy.ownerPrivate).toBeUndefined();
    await asBob(t).mutation(api.library.updateCopySharing.updateCopySharing, {
      copyId: copyIds[0]!,
      visibility: "visible",
      forSale: true,
      salePrice: { amountCents: 1000, currency: "EUR" },
    });
    const exchangeId = await asAlice(t).mutation(api.exchange.propose.propose, {
      recipientId: bob,
      type: "sale",
      requestedPuzzleId: copy._id,
      salePrice: 1000,
    });
    await asBob(t).mutation(api.exchange.accept.accept, { exchangeId });
    await asAlice(t).mutation(
      api.exchange.confirmCompletion.confirmCompletion,
      { exchangeId },
    );
    await asBob(t).mutation(api.exchange.confirmCompletion.confirmCompletion, {
      exchangeId,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const row = await t.run((ctx) => ctx.db.get(copy._id));
    expect(row?.ownerId).toBe(alice);
    expect(row?.ownerPrivate).toBe(true);
    expect(row?.isOpen).toBe(false);
    expect(row?.listedAt).toBeUndefined();
  });
});

describe("library.backfillCopyOpenFlag", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const backfill = internal.library.backfillCopyOpenFlag.backfillCopyOpenFlag;

  type SeedRow = {
    availability: Avail;
    isOpen?: boolean;
    listedAt?: number;
    ownerPrivate?: true;
    // The owner's profile visibility (default public).
    owner?: "public" | "private";
  };

  const seedRows = (t: TestConvex<typeof schema>, rows: SeedRow[]) =>
    t.run(async (ctx) => {
      const mkOwner = async (
        name: string,
        visibility: "public" | "private",
      ) => {
        const id = await ctx.db.insert("users", {
          clerkId: `clerk_${name}`,
          email: `${name}@example.com`,
          name,
          isActive: true,
          createdAt: NOW,
          updatedAt: NOW,
        });
        await ctx.db.insert("profiles", {
          memberId: id,
          displayName: name,
          visibility,
          updatedAt: NOW,
        });
        return id;
      };
      const owners = {
        public: await mkOwner("owner", "public"),
        private: await mkOwner("hermit", "private"),
      };
      const puzzleId = await ctx.db.insert("puzzles", {
        title: "P",
        pieceCount: 500,
        status: "approved",
        submittedBy: owners.public,
        createdAt: NOW,
        updatedAt: NOW,
      });
      const ids: Id<"ownedPuzzles">[] = [];
      for (const { owner, ...extra } of rows) {
        ids.push(
          await ctx.db.insert("ownedPuzzles", {
            puzzleId,
            ownerId: owners[owner ?? "public"],
            condition: "good",
            createdAt: NOW,
            updatedAt: NOW,
            ...extra,
          }),
        );
      }
      return ids;
    });

  const rowsOf = (t: TestConvex<typeof schema>, ids: Id<"ownedPuzzles">[]) =>
    t.run(async (ctx) => Promise.all(ids.map((id) => ctx.db.get(id))));

  // Run the first batch, then drain the self-rescheduled ones.
  const runAll = async (
    t: TestConvex<typeof schema>,
    args: { dryRun?: boolean; batchSize?: number } = {},
  ) => {
    vi.useFakeTimers();
    try {
      const first = await t.mutation(backfill, args);
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      return first;
    } finally {
      vi.useRealTimers();
    }
  };

  // Totals of the whole run, from the last batch's log line.
  const lastTotals = () => {
    const calls = vi.mocked(console.log).mock.calls;
    const line = JSON.parse(String(calls[calls.length - 1]![0])) as {
      totals: Record<string, number>;
      is_done: boolean;
    };
    expect(line.is_done).toBe(true);
    return line.totals;
  };

  const LISTED = NOW + 5;
  const MIXED: SeedRow[] = [
    { availability: { ...CLOSED, forTrade: true } }, // legacy open
    { availability: CLOSED }, // legacy closed
    { availability: { ...CLOSED, forSale: true }, isOpen: false }, // drifted: open, flagged closed
    { availability: CLOSED, isOpen: true, listedAt: LISTED }, // drifted: closed, flagged open
    { availability: { ...CLOSED, forLend: true }, isOpen: true }, // flagged open, never listed
    {
      availability: { ...CLOSED, forLend: true },
      isOpen: false,
      owner: "private",
    }, // private owner
    {
      availability: { ...CLOSED, forLend: true },
      isOpen: true,
      listedAt: LISTED,
      ownerPrivate: true,
    }, // owner is public
    {
      availability: { ...CLOSED, forLend: true },
      isOpen: true,
      listedAt: LISTED,
    }, // in step
    {
      availability: CLOSED,
      isOpen: false,
      owner: "private",
      ownerPrivate: true,
    }, // in step
  ];

  test("a dry run counts what it would write and writes nothing", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedRows(t, MIXED);
    const before = await rowsOf(t, ids);

    const first = await runAll(t, { dryRun: true });
    expect(first).toEqual({ scanned: 9, set: 2, repaired: 5, inStep: 2 });
    expect(await rowsOf(t, ids)).toEqual(before);
  });

  test("sets the listing fields on legacy rows, repairs drifted rows and leaves the rest alone", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedRows(t, MIXED);
    const before = await rowsOf(t, ids);

    await runAll(t);
    const after = await rowsOf(t, ids);
    expect(
      after.map((row) => [row?.isOpen, row?.listedAt, row?.ownerPrivate]),
    ).toEqual([
      // A copy open before `listedAt` existed is listed when it was created: today's order.
      [true, NOW, undefined],
      [false, undefined, undefined],
      [true, NOW, undefined],
      [false, undefined, undefined],
      [true, NOW, undefined],
      [true, NOW, true],
      [true, LISTED, undefined],
      [true, LISTED, undefined],
      [false, undefined, true],
    ]);
    // Only the listing fields change: availability and updatedAt are not an owner edit.
    const rest = (row: Doc<"ownedPuzzles"> | null) => {
      const {
        isOpen: _isOpen,
        listedAt: _listedAt,
        ownerPrivate: _ownerPrivate,
        ...others
      } = row!;
      return others;
    };
    after.forEach((row, i) => expect(rest(row)).toEqual(rest(before[i]!)));
  });

  test("pages through the table in batches and carries the totals", async () => {
    const t = convexTest(schema, modules);
    await seedRows(t, MIXED);

    const first = await runAll(t, { batchSize: 2 });
    expect(first.scanned).toBe(2);
    expect(lastTotals()).toEqual({
      scanned: 9,
      set: 2,
      repaired: 5,
      inStep: 2,
    });
  });

  test("a second run writes nothing", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedRows(t, MIXED);
    await runAll(t);
    const once = await rowsOf(t, ids);

    await runAll(t);
    expect(lastTotals()).toEqual({
      scanned: 9,
      set: 0,
      repaired: 0,
      inStep: 9,
    });
    expect(await rowsOf(t, ids)).toEqual(once);
  });
});
