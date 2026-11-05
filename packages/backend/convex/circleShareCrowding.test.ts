import presenceTest from "@convex-dev/presence/test";
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import {
  CIRCLE_SHARES_READ_PER_CIRCLE,
  circleShareCandidates,
} from "./library/circleSharedCopies";
import schema from "./schema";

// A share read of a busy circle is bounded, so one member's shares must not use up what the others'
// need: a seat in a circle is all it takes to share 200 copies into it (rate limits allow 1,000 a
// day). What a circle mate can see must not depend on what another member shared since.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);
type T = TestConvex<typeof schema>;

const BASE = 1_700_000_000_000;
const OPEN = { forTrade: true, forSale: false, forLend: false };
const CLOSED = { forTrade: false, forSale: false, forLend: false };

const mkUser = (ctx: MutationCtx, name: string) =>
  ctx.db.insert("users", {
    clerkId: `clerk_${name}`,
    email: `${name}@example.com`,
    name,
    isActive: true,
    createdAt: BASE,
    updatedAt: BASE,
  });

const mkCircle = async (
  ctx: MutationCtx,
  aggregateId: string,
  ownerId: Id<"users">,
  members: Id<"users">[],
) => {
  await ctx.db.insert("circles", {
    aggregateId,
    ownerId,
    name: aggregateId,
    memberships: members.map((memberId, i) => ({
      id: `${aggregateId}-${i}`,
      memberId,
      permission: "Exchange" as const,
      joinedAt: BASE,
    })),
    createdAt: BASE,
  });
  for (const memberId of members) {
    await ctx.db.insert("circleMembers", {
      circleAggregateId: aggregateId,
      memberId,
    });
  }
};

// Alice has a private profile, so her copies only reach Carol through a circle. Bob has a seat next to
// them both, and public or private makes no difference to what he can do.
const seedCircle = (t: T) =>
  t.run(async (ctx) => {
    const alice = await mkUser(ctx, "alice");
    const bob = await mkUser(ctx, "bob");
    const carol = await mkUser(ctx, "carol");
    await ctx.db.insert("profiles", {
      memberId: alice,
      visibility: "private",
      updatedAt: BASE,
    });
    await mkCircle(ctx, "friends", alice, [alice, bob, carol]);
    const puzzleId = await ctx.db.insert("puzzles", {
      title: "Harbour",
      pieceCount: 1000,
      status: "approved",
      submittedBy: alice,
      createdAt: BASE,
      updatedAt: BASE,
    });
    return { alice, bob, carol, puzzleId };
  });

const addCopies = async (
  t: T,
  ownerId: Id<"users">,
  puzzleId: Id<"puzzles">,
  prefix: string,
  count: number,
  fields: Partial<Doc<"ownedPuzzles">> = {},
) => {
  const ids: string[] = [];
  for (let start = 0; start < count; start += 100) {
    await t.run(async (ctx) => {
      for (let i = start; i < Math.min(count, start + 100); i++) {
        const aggregateId = `${prefix}-${i}`;
        await ctx.db.insert("ownedPuzzles", {
          aggregateId,
          puzzleId,
          ownerId,
          condition: "good",
          availability: CLOSED,
          isOpen: false,
          createdAt: BASE,
          updatedAt: BASE,
          ...fields,
        });
        ids.push(aggregateId);
      }
    });
  }
  return ids;
};

// Through the public functions, a batch at a time, as a member's own client would.
const shareAs = async (
  t: T,
  name: string,
  copyIds: string[],
  circleId = "friends",
) => {
  for (let start = 0; start < copyIds.length; start += 100) {
    await t
      .withIdentity({ subject: `clerk_${name}` })
      .mutation(api.sharing.shareCopiesToCircle.shareCopiesToCircle, {
        circleId,
        copyIds: copyIds.slice(start, start + 100),
      });
  }
};

// The cards on a circle's page name a copy by its row.
const rowIdsOf = (t: T, copyIds: string[]) =>
  t.run(async (ctx) => {
    const rows = await Promise.all(
      copyIds.map((copyId) =>
        ctx.db
          .query("ownedPuzzles")
          .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", copyId))
          .unique(),
      ),
    );
    return rows.map((row) => row!._id as string);
  });

const browseAsCarol = (t: T, cursor?: string | null) =>
  t
    .withIdentity({ subject: "clerk_carol" })
    .query(api.library.browseOwnedPuzzles.browseOwnedPuzzles, {
      limit: 48,
      cursor,
    });

const stripAsCarol = (t: T) =>
  t
    .withIdentity({ subject: "clerk_carol" })
    .query(api.sharing.listCircleSharedCopies.listCircleSharedCopies, {
      circleId: "friends",
    });

// Alice's one open copy, offered through the circle before Bob's pile arrives.
const seedAlicesOffer = async (t: T) => {
  const world = await seedCircle(t);
  const [copyId] = await addCopies(t, world.alice, world.puzzleId, "alice", 1, {
    availability: OPEN,
    isOpen: true,
    listedAt: BASE + 5,
    ownerPrivate: true,
  });
  await shareAs(t, "alice", [copyId]);
  return { ...world, copyId };
};

const runBackfill = async (
  t: T,
  args: { dryRun?: boolean; batchSize?: number },
) => {
  vi.useFakeTimers();
  try {
    const first = await t.mutation(
      internal.sharing.backfillCircleShareOwners.backfillCircleShareOwners,
      args,
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    return first;
  } finally {
    vi.useRealTimers();
  }
};

describe("one member's shares don't take a circle mate's copy away", () => {
  test("200 closed copies leave a private member's open copy on Browse", async () => {
    const t = convexTest(schema, modules);
    const { bob, puzzleId, copyId } = await seedAlicesOffer(t);
    expect((await browseAsCarol(t)).ownedPuzzles).toHaveLength(1);

    await shareAs(t, "bob", await addCopies(t, bob, puzzleId, "bob", 200));

    const { ownedPuzzles } = await browseAsCarol(t);
    expect(ownedPuzzles.map((row) => row.aggregateId)).toEqual([copyId]);
  });

  test("200 of them, hidden, leave it on the circle's page", async () => {
    const t = convexTest(schema, modules);
    const { bob, puzzleId } = await seedAlicesOffer(t);

    await shareAs(
      t,
      "bob",
      await addCopies(t, bob, puzzleId, "bob", 200, {
        visibility: "private",
        visibilityAuthoritative: true,
      }),
    );

    expect(await stripAsCarol(t)).toHaveLength(1);
  });

  test("200 open copies don't push it off Browse either", async () => {
    const t = convexTest(schema, modules);
    const { bob, puzzleId, copyId } = await seedAlicesOffer(t);

    await shareAs(
      t,
      "bob",
      await addCopies(t, bob, puzzleId, "bob", 200, {
        availability: OPEN,
        isOpen: true,
        listedAt: BASE + 10,
      }),
    );

    const seen: (string | undefined)[] = [];
    let cursor: string | null | undefined;
    do {
      const page = await browseAsCarol(t, cursor);
      seen.push(...page.ownedPuzzles.map((row) => row.aggregateId));
      cursor = page.continueCursor;
    } while (cursor);
    expect(seen).toContain(copyId);
  });

  test("a member's newest copies take only a share of the circle's page while others have some", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, puzzleId } = await seedCircle(t);
    const visible = {
      availability: OPEN,
      isOpen: true,
      listedAt: BASE,
      visibility: "visible" as const,
      visibilityAuthoritative: true,
    };
    const alices = await addCopies(t, alice, puzzleId, "alice", 3, {
      ...visible,
      ownerPrivate: true,
    });
    await shareAs(t, "alice", alices);
    await shareAs(
      t,
      "bob",
      await addCopies(t, bob, puzzleId, "bob", 20, visible),
    );

    const cards = (await stripAsCarol(t)).map((card) => card.copyId);

    expect(cards).toHaveLength(12);
    expect(cards).toEqual(expect.arrayContaining(await rowIdsOf(t, alices)));
  });

  test("a circle page with room shows one member's copies, newest first", async () => {
    const t = convexTest(schema, modules);
    const { bob, puzzleId } = await seedCircle(t);
    const copies = await addCopies(t, bob, puzzleId, "bob", 15, {
      availability: OPEN,
      isOpen: true,
      listedAt: BASE,
      visibility: "visible",
      visibilityAuthoritative: true,
    });
    for (const copyId of copies) await shareAs(t, "bob", [copyId]);

    const cards = await stripAsCarol(t);

    expect(cards.map((card) => card.copyId)).toEqual(
      await rowIdsOf(t, [...copies].reverse().slice(0, 12)),
    );
  });
});

describe("what a circle's bounded share read holds", () => {
  const candidatesOf = (t: T, viewer: Id<"users">) =>
    t.run(async (ctx) => {
      const candidates = await circleShareCandidates(ctx, viewer);
      return candidates.map(({ row }) => ({
        copy: row.aggregateId,
        owner: row.ownerId,
      }));
    });

  test("a circle within the bound: every share, however lopsided", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, carol, puzzleId } = await seedCircle(t);
    await shareAs(t, "alice", await addCopies(t, alice, puzzleId, "alice", 2));
    await shareAs(
      t,
      "bob",
      await addCopies(
        t,
        bob,
        puzzleId,
        "bob",
        CIRCLE_SHARES_READ_PER_CIRCLE - 2,
      ),
    );

    expect(await candidatesOf(t, carol)).toHaveLength(
      CIRCLE_SHARES_READ_PER_CIRCLE,
    );
  });

  test("a busy circle: the read goes round the members who have shares left", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, carol, puzzleId } = await seedCircle(t);
    await shareAs(
      t,
      "alice",
      await addCopies(t, alice, puzzleId, "alice", 150),
    );
    await shareAs(t, "bob", await addCopies(t, bob, puzzleId, "bob", 150));
    await shareAs(t, "carol", await addCopies(t, carol, puzzleId, "carol", 3));

    const candidates = await candidatesOf(t, carol);

    const of = (owner: Id<"users">) =>
      candidates.filter((c) => c.owner === owner).length;
    expect(candidates).toHaveLength(CIRCLE_SHARES_READ_PER_CIRCLE);
    expect(of(carol)).toBe(3);
    expect(Math.abs(of(alice) - of(bob))).toBeLessThanOrEqual(1);
  });

  test("a busy circle: a member's newest shares are the ones read", async () => {
    const t = convexTest(schema, modules);
    const { alice, carol, puzzleId } = await seedCircle(t);
    const copies = await addCopies(t, alice, puzzleId, "alice", 210);
    await shareAs(t, "alice", copies);

    const candidates = await candidatesOf(t, carol);

    expect(candidates.map((c) => c.copy).sort()).toEqual(
      copies.slice(10).sort(),
    );
  });

  test("before the backfill a busy circle reads its newest shares, as ever", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, carol, puzzleId } = await seedCircle(t);
    const copies = await addCopies(t, bob, puzzleId, "bob", 205);
    const older = await addCopies(t, alice, puzzleId, "alice", 1);
    // Rows as they were written before shares carried an owner: Alice's oldest of all.
    await t.run(async (ctx) => {
      for (const copyId of [...older, ...copies]) {
        await ctx.db.insert("circleCopyShares", {
          circleId: "friends",
          copyId,
          sharedAt: BASE,
        });
      }
    });

    const before = await candidatesOf(t, carol);
    expect(before).toHaveLength(CIRCLE_SHARES_READ_PER_CIRCLE);
    expect(before.some((c) => c.owner === alice)).toBe(false);

    await runBackfill(t, {});

    const after = await candidatesOf(t, carol);
    expect(after).toHaveLength(CIRCLE_SHARES_READ_PER_CIRCLE);
    expect(after.some((c) => c.owner === alice)).toBe(true);
  });

  test("a share names its owner, through either way of sharing", async () => {
    const t = convexTest(schema, modules);
    const { alice, puzzleId } = await seedCircle(t);
    const copies = await addCopies(t, alice, puzzleId, "alice", 2);
    await shareAs(t, "alice", copies.slice(0, 1));
    await t
      .withIdentity({ subject: "clerk_alice" })
      .mutation(api.sharing.shareCopyToCircle.shareCopyToCircle, {
        circleId: "friends",
        copyId: copies[1],
      });

    const owners = await t.run(async (ctx) =>
      (await ctx.db.query("circleCopyShares").collect()).map((s) => s.ownerId),
    );
    expect(owners).toEqual([alice, alice]);
  });
});

// A share names its owner, so it can't outlive the copy: nothing would ever find it again by that name,
// and it would hold the owner's place in a busy circle for a copy that isn't there.
describe("a deleted copy's shares go with it", () => {
  const sharesOf = (t: T) =>
    t.run((ctx) => ctx.db.query("circleCopyShares").collect());

  const settleDueJobs = async (t: T) => {
    for (let i = 0; i < 400; i++) {
      await t.finishInProgressScheduledFunctions();
      const jobs = await t.run((ctx) =>
        ctx.db.system.query("_scheduled_functions").collect(),
      );
      const busy = jobs.some(
        (job) =>
          job.state.kind === "inProgress" ||
          (job.state.kind === "pending" && job.scheduledTime <= Date.now()),
      );
      if (!busy) return;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error("scheduled functions did not settle");
  };

  test("deleting a copy withdraws it from every circle, and leaves other copies' shares", async () => {
    const t = convexTest(schema, modules);
    const { alice, puzzleId } = await seedCircle(t);
    const [gone, kept] = await addCopies(t, alice, puzzleId, "alice", 2);
    await t.run((ctx) => mkCircle(ctx, "family", alice, [alice]));
    await shareAs(t, "alice", [gone, kept]);
    await shareAs(t, "alice", [gone], "family");

    await t
      .withIdentity({ subject: "clerk_alice" })
      .mutation(api.library.deleteCopy.deleteCopy, { copyId: gone });

    expect((await sharesOf(t)).map((share) => share.copyId)).toEqual([kept]);
  });

  test("a member who deleted a shared copy is named by no share after erasure", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const t = convexTest(schema, modules);
    // The purge's presence phase runs before the copies.
    presenceTest.register(t);
    const { alice, puzzleId } = await seedCircle(t);
    const [gone, kept] = await addCopies(t, alice, puzzleId, "alice", 2);
    await shareAs(t, "alice", [gone, kept]);
    await t
      .withIdentity({ subject: "clerk_alice" })
      .mutation(api.library.deleteCopy.deleteCopy, { copyId: gone });
    await settleDueJobs(t);

    await t.mutation(internal.users.deleteUser, { id: "clerk_alice" });
    await settleDueJobs(t);

    expect(await t.run((ctx) => ctx.db.get(alice))).toBeNull();
    expect(await sharesOf(t)).toEqual([]);
    vi.restoreAllMocks();
  });
});

describe("under Convex's real limits", () => {
  const many = async (t: T, count: number, prefix: string) => {
    const ids: Id<"users">[] = [];
    await t.run(async (ctx) => {
      for (let i = 0; i < count; i++) {
        ids.push(await mkUser(ctx, `${prefix}${i}`));
      }
    });
    return ids;
  };

  // A viewer in `circles` circles of 50 members, each holding more shares of its own copies than the
  // read gets, all of one member's and closed, so every share read also costs its copy's row.
  const busyCircles = async (circles: number, sharesEach: number) => {
    const t = convexTest({ schema, modules, transactionLimits: true });
    const { carol, bob, puzzleId } = await seedCircle(t);
    const others = await many(t, 48, "other");
    const seats = [carol, bob, ...others];
    for (let c = 0; c < circles; c++) {
      await t.run((ctx) => mkCircle(ctx, `busy-${c}`, bob, seats));
      const copies = await addCopies(t, bob, puzzleId, `c${c}`, sharesEach);
      await t.run(async (ctx) => {
        for (const copyId of copies) {
          await ctx.db.insert("circleCopyShares", {
            circleId: `busy-${c}`,
            copyId,
            ownerId: bob,
            sharedAt: BASE,
          });
        }
      });
    }
    return t;
  };

  test("Browse holds for a viewer in 12 busy circles of 50", async () => {
    const t = await busyCircles(12, 60);
    expect((await browseAsCarol(t)).ownedPuzzles).toEqual([]);
  }, 300_000);

  test("Browse holds for a viewer in 100 busy circles of 50", async () => {
    const t = await busyCircles(100, 8);
    expect((await browseAsCarol(t)).ownedPuzzles).toEqual([]);
  }, 300_000);
});

describe("sharing/backfillCircleShareOwners", () => {
  const run = (t: T, args: { dryRun?: boolean; batchSize?: number }) =>
    runBackfill(t, args);

  const seedLegacyShares = async (t: T) => {
    const { alice, bob, puzzleId } = await seedCircle(t);
    const copies = [
      ...(await addCopies(t, alice, puzzleId, "alice", 3)),
      ...(await addCopies(t, bob, puzzleId, "bob", 3)),
    ];
    await t.run(async (ctx) => {
      for (const copyId of [...copies, "deleted-copy"]) {
        await ctx.db.insert("circleCopyShares", {
          circleId: "friends",
          copyId,
          sharedAt: BASE,
        });
      }
    });
    return { alice, bob };
  };

  const ownersByCopy = (t: T) =>
    t.run(async (ctx) =>
      Object.fromEntries(
        (await ctx.db.query("circleCopyShares").collect()).map((s) => [
          s.copyId,
          s.ownerId,
        ]),
      ),
    );

  test("names each share's owner across batches, and leaves a share of no copy alone", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seedLegacyShares(t);

    await run(t, { batchSize: 2 });

    const owners = await ownersByCopy(t);
    expect(owners["alice-0"]).toBe(alice);
    expect(owners["alice-2"]).toBe(alice);
    expect(owners["bob-2"]).toBe(bob);
    expect(owners["deleted-copy"]).toBeUndefined();
  });

  test("a dry run writes nothing and a second run has nothing left to write", async () => {
    const t = convexTest(schema, modules);
    await seedLegacyShares(t);
    const rows = () =>
      t.run((ctx) => ctx.db.query("circleCopyShares").collect());

    const before = await rows();
    await run(t, { dryRun: true });
    expect(await rows()).toEqual(before);

    await run(t, {});
    const once = await rows();
    await run(t, {});
    expect(await rows()).toEqual(once);
  });

  test("first batch's counts", async () => {
    const t = convexTest(schema, modules);
    await seedLegacyShares(t);

    expect(await run(t, {})).toEqual({
      scanned: 7,
      set: 6,
      inStep: 0,
      noCopy: 1,
    });
    expect(await run(t, {})).toEqual({
      scanned: 7,
      set: 0,
      inStep: 6,
      noCopy: 1,
    });
  });
});
