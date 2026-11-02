import {
  OwnershipTransferred,
  toCopyId,
  toExchangeId,
  toMemberId,
} from "@jigswap/domain";
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { deleteOwnCopies } from "./conversation/purgeMemberLibrary";
import { inProcessEventPublisher } from "./exchange/adapters/inProcessEventPublisher";
import {
  LIBRARY_COUNT_SCAN_CAP,
  readMemberLibraryCounts,
} from "./library/memberLibraryCounts";
import { handleDomainEvent } from "./library/transferOnSettlement";
import schema from "./schema";

// The per-member owned/forTrade counters behind library.myShelf (PERF-B5q). Every write that adds,
// removes, re-owns or re-offers a copy keeps them in step, so the shelf no longer scans the library
// and an edit that changes neither number leaves them, and the shelf's subscription, alone.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;

const closed = { forTrade: false, forSale: false, forLend: false };
const swap = { forTrade: true, forSale: false, forLend: false };

interface World {
  ann: Id<"users">;
  bob: Id<"users">;
  puzzleId: Id<"puzzles">;
  definitionId: string;
}

const seed = (t: T): Promise<World> =>
  t.run(async (ctx) => {
    const now = Date.now();
    const user = (name: string) =>
      ctx.db.insert("users", {
        clerkId: `clerk_${name}`,
        email: `${name}@example.com`,
        name,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const ann = await user("ann");
    const bob = await user("bob");
    const definitionId = "def-1";
    const puzzleId = await ctx.db.insert("puzzles", {
      aggregateId: definitionId,
      title: "Harbour Lights",
      pieceCount: 1000,
      status: "approved",
      submittedBy: ann,
      createdAt: now,
      updatedAt: now,
    });
    return { ann, bob, puzzleId, definitionId };
  });

// A row written directly, bypassing every write path, as a row from before the counters existed.
const legacyCopy = (
  t: T,
  w: World,
  ownerId: Id<"users">,
  extra: Partial<Doc<"ownedPuzzles">> = {},
) =>
  t.run((ctx) =>
    ctx.db.insert("ownedPuzzles", {
      puzzleId: w.puzzleId,
      ownerId,
      condition: "good",
      availability: closed,
      createdAt: 1,
      updatedAt: 1,
      ...extra,
    }),
  );

const countsRow = (t: T, memberId: Id<"users">) =>
  t.run((ctx) =>
    ctx.db
      .query("memberLibraryCounts")
      .withIndex("by_member", (q) => q.eq("memberId", memberId))
      .unique(),
  );

const numbers = async (t: T, memberId: Id<"users">) => {
  const row = await countsRow(t, memberId);
  return row && { owned: row.owned, forTrade: row.forTrade };
};

const acquire = (t: T, w: World, who = "ann") =>
  t
    .withIdentity({ subject: `clerk_${who}` })
    .mutation(api.library.acquireCopy.acquireCopy, {
      puzzleDefinitionId: w.definitionId,
      condition: "good",
    });

const offer = (t: T, copyIds: string[], forTrade: boolean, who = "ann") =>
  t
    .withIdentity({ subject: `clerk_${who}` })
    .mutation(api.library.updateCopiesOffers.updateCopiesOffers, {
      copyIds,
      forTrade,
    });

const shelfOf = (t: T, who = "ann") =>
  t
    .withIdentity({ subject: `clerk_${who}` })
    .query(api.library.getMyShelf.getMyShelf, {});

let t: T;
let w: World;

beforeEach(async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.spyOn(console, "log").mockImplementation(() => {});
  t = convexTest(schema, modules);
  w = await seed(t);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("write paths keep the counters", () => {
  test("a member's first write counts the copies they already had", async () => {
    await legacyCopy(t, w, w.ann);
    await legacyCopy(t, w, w.ann, { availability: swap });
    expect(await countsRow(t, w.ann)).toBeNull();

    await acquire(t, w);

    expect(await numbers(t, w.ann)).toEqual({ owned: 3, forTrade: 1 });
  });

  test("acquire, offer, withdraw and delete move the numbers one by one", async () => {
    const copyId = await acquire(t, w);
    expect(await numbers(t, w.ann)).toEqual({ owned: 1, forTrade: 0 });

    await offer(t, [copyId], true);
    expect(await numbers(t, w.ann)).toEqual({ owned: 1, forTrade: 1 });

    await offer(t, [copyId], false);
    expect(await numbers(t, w.ann)).toEqual({ owned: 1, forTrade: 0 });

    await acquire(t, w);
    await t
      .withIdentity({ subject: "clerk_ann" })
      .mutation(api.library.deleteCopy.deleteCopy, { copyId });
    expect(await numbers(t, w.ann)).toEqual({ owned: 1, forTrade: 0 });
  });

  test("a bulk offer counts every copy it changes, once", async () => {
    const ids = [await acquire(t, w), await acquire(t, w), await acquire(t, w)];
    await offer(t, ids, true);
    expect(await numbers(t, w.ann)).toEqual({ owned: 3, forTrade: 3 });
    // Offering again changes nothing.
    await offer(t, ids, true);
    expect(await numbers(t, w.ann)).toEqual({ owned: 3, forTrade: 3 });
  });

  test("an edit that moves neither number does not write the row", async () => {
    const copyId = await acquire(t, w);
    const before = await countsRow(t, w.ann);
    await t
      .withIdentity({ subject: "clerk_ann" })
      .mutation(api.library.updateCopyDetails.updateCopyDetails, {
        copyId,
        notes: "corner is bent",
      });
    expect(await countsRow(t, w.ann)).toEqual(before);
  });

  test("a copy changing hands leaves one count and joins the other", async () => {
    const copyId = await acquire(t, w);
    await offer(t, [copyId], true);
    await acquire(t, w, "bob");
    const row = await t.run((ctx) =>
      ctx.db
        .query("ownedPuzzles")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", copyId))
        .unique(),
    );

    await t.run((ctx) =>
      inProcessEventPublisher(ctx).publish([
        new OwnershipTransferred(
          toExchangeId("x-1"),
          toCopyId(row!._id),
          toMemberId(w.bob),
          undefined,
          new Date(),
        ),
      ]),
    );
    // The settlement closes the offer in its own transaction, before the owner changes.
    expect(await numbers(t, w.ann)).toEqual({ owned: 1, forTrade: 0 });

    // The async reaction then moves the copy.
    await t.run((ctx) =>
      handleDomainEvent(ctx, {
        _id: "e" as Id<"domainEvents">,
        _creationTime: 0,
        name: "OwnershipTransferred",
        payload: { copyId: row!._id, newOwner: w.bob },
        occurredAt: Date.now(),
        context: "exchange",
      }),
    );
    expect(await numbers(t, w.ann)).toEqual({ owned: 0, forTrade: 0 });
    expect(await numbers(t, w.bob)).toEqual({ owned: 2, forTrade: 0 });
  });

  test("the copies purge removes the member's counters with their copies", async () => {
    await acquire(t, w);
    expect(await countsRow(t, w.ann)).not.toBeNull();

    await t.run(async (ctx) => {
      let cursor: string | null = null;
      for (;;) {
        const page = await deleteOwnCopies(ctx, w.ann, {
          cursor,
          numItems: 10,
        });
        if (page.isDone) return;
        cursor = page.continueCursor;
      }
    });

    expect(await countsRow(t, w.ann)).toBeNull();
  });
});

describe("library.myShelf reads the counters", () => {
  test("uses the row and does not scan the library", async () => {
    await legacyCopy(t, w, w.ann);
    await t.run((ctx) =>
      ctx.db.insert("memberLibraryCounts", {
        memberId: w.ann,
        owned: 40,
        forTrade: 7,
      }),
    );
    const shelf = await shelfOf(t);
    expect(shelf.total).toBe(40);
    expect(shelf.forTrade).toBe(7);
    expect(shelf.recent).toHaveLength(1);
  });

  test("before the backfill it counts the library, so nobody sees a zero", async () => {
    await legacyCopy(t, w, w.ann);
    await legacyCopy(t, w, w.ann, { availability: swap });
    const shelf = await shelfOf(t);
    expect(shelf.total).toBe(2);
    expect(shelf.forTrade).toBe(1);
  });
});

describe("identity.getUserStats", () => {
  const statsOf = (who: string, userId: Id<"users">) =>
    t
      .withIdentity({ subject: `clerk_${who}` })
      .query(api.identity.getUserStats.getUserStats, { userId });

  test("your own stats read the counter; another member's still leave private copies out", async () => {
    await legacyCopy(t, w, w.ann);
    await legacyCopy(t, w, w.ann, {
      visibility: "private",
      visibilityAuthoritative: true,
    });
    await t.run((ctx) =>
      ctx.db.insert("memberLibraryCounts", {
        memberId: w.ann,
        owned: 40,
        forTrade: 0,
      }),
    );
    expect((await statsOf("ann", w.ann))?.puzzlesOwned).toBe(40);
    expect((await statsOf("bob", w.ann))?.puzzlesOwned).toBe(1);
  });
});

describe("readMemberLibraryCounts", () => {
  test("a member past the scan cap gets the cap, not a failed read", async () => {
    await t.run(async (ctx) => {
      for (let i = 0; i <= LIBRARY_COUNT_SCAN_CAP; i++) {
        await ctx.db.insert("ownedPuzzles", {
          puzzleId: w.puzzleId,
          ownerId: w.ann,
          condition: "good",
          availability: closed,
          createdAt: i,
          updatedAt: i,
        });
      }
    });
    const counts = await t.run((ctx) => readMemberLibraryCounts(ctx, w.ann));
    expect(counts.owned).toBe(LIBRARY_COUNT_SCAN_CAP);
    expect(counts.complete).toBe(false);

    // The admin list says so, because it is the page used to find the account.
    const asAdmin = t.withIdentity({
      subject: "clerk_ann",
      metadata: { role: "admin" },
    });
    const { page } = await asAdmin.query(api.admin.listUsers.listUsers, {
      paginationOpts: { numItems: 25, cursor: null },
    });
    const row = page.find((user) => user._id === w.ann);
    expect(row?.ownedCopyCount).toBe(LIBRARY_COUNT_SCAN_CAP);
    expect(row?.ownedCopyCountIsLowerBound).toBe(true);
  });

  test("a counted member's numbers are complete", async () => {
    await legacyCopy(t, w, w.ann);
    const counts = await t.run((ctx) => readMemberLibraryCounts(ctx, w.ann));
    expect(counts).toEqual({ owned: 1, forTrade: 0, complete: true });
  });
});

describe("backfillMemberLibraryCounts", () => {
  const run = (args: { dryRun?: boolean; batchSize?: number }): Promise<void> =>
    t
      .mutation(
        internal.library.backfillMemberLibraryCounts
          .backfillMemberLibraryCounts,
        args,
      )
      .then(() => undefined);

  const settle = async () => {
    await vi.runAllTimersAsync();
    await t.finishInProgressScheduledFunctions();
  };

  test("writes every member's row across batches and is idempotent", async () => {
    await legacyCopy(t, w, w.ann);
    await legacyCopy(t, w, w.ann, { availability: swap });
    await legacyCopy(t, w, w.bob, { availability: swap });

    await run({ batchSize: 1 });
    await settle();

    expect(await numbers(t, w.ann)).toEqual({ owned: 2, forTrade: 1 });
    expect(await numbers(t, w.bob)).toEqual({ owned: 1, forTrade: 1 });

    const before = await countsRow(t, w.ann);
    await run({ batchSize: 1 });
    await settle();
    expect(await countsRow(t, w.ann)).toEqual(before);
  });

  test("a dry run counts without writing", async () => {
    await legacyCopy(t, w, w.ann);
    await run({ dryRun: true });
    await settle();
    expect(await countsRow(t, w.ann)).toBeNull();
  });

  test("repairs a row that drifted", async () => {
    await legacyCopy(t, w, w.ann);
    await t.run((ctx) =>
      ctx.db.insert("memberLibraryCounts", {
        memberId: w.ann,
        owned: 99,
        forTrade: 99,
      }),
    );
    await run({});
    await settle();
    expect(await numbers(t, w.ann)).toEqual({ owned: 1, forTrade: 0 });
  });

  test("leaves a member past the scan cap without a row", async () => {
    await t.run(async (ctx) => {
      for (let i = 0; i <= LIBRARY_COUNT_SCAN_CAP; i++) {
        await ctx.db.insert("ownedPuzzles", {
          puzzleId: w.puzzleId,
          ownerId: w.ann,
          condition: "good",
          availability: closed,
          createdAt: i,
          updatedAt: i,
        });
      }
    });
    await run({});
    await settle();
    expect(await countsRow(t, w.ann)).toBeNull();
  });
});
