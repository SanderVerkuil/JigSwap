import presenceTest from "@convex-dev/presence/test";
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { computeDefinitionTotals } from "./library/definitionStats";
import schema from "./schema";

// The definitionStats read model (PERF-B4m, SEC-29): one row per catalogue definition holding the
// viewer-independent aggregates the catalog and definition pages show, recomputed from source by a
// scheduled job whenever a write marks the definition, and by a nightly reconcile that doubles as
// the backfill. Reads fall back to the live helpers until a definition's totals exist.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);
type T = TestConvex<typeof schema>;
type Avail = Doc<"ownedPuzzles">["availability"];

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const BASE = 1_700_000_000_000;
const CLOSED: Avail = { forTrade: false, forSale: false, forLend: false };

let logs: string[] = [];
beforeEach(() => {
  logs = [];
  vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
    logs.push(parts.map(String).join(" "));
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

const newT = (transactionLimits?: { documentsRead: number }): T => {
  const t = convexTest({ schema, modules, transactionLimits });
  // The account purge's presence phase needs the component.
  presenceTest.register(t);
  return t;
};

// Runs every scheduled function that is due (event dispatch, stats recomputes, the reconcile's and
// the purge's next batches) until none is left. Delayed ones (the purge's event scrub) stay pending.
const settle = async (t: T) => {
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

const asUser = (t: T, name: string) =>
  t.withIdentity({ subject: `clerk_${name}` });

// alice and bob (public profiles), noah (private profile) and three approved definitions.
const seedWorld = (t: T) =>
  t.run(async (ctx) => {
    const mkUser = async (name: string, visibility: "public" | "private") => {
      const id = await ctx.db.insert("users", {
        clerkId: `clerk_${name}`,
        email: `${name}@example.com`,
        name,
        isActive: true,
        createdAt: BASE,
        updatedAt: BASE,
      });
      await ctx.db.insert("profiles", {
        memberId: id,
        displayName: name,
        visibility,
        updatedAt: BASE,
      });
      return id;
    };
    const alice = await mkUser("alice", "public");
    const bob = await mkUser("bob", "public");
    const noah = await mkUser("noah", "private");
    const mkPuzzle = async (title: string) => {
      const aggregateId = crypto.randomUUID();
      const id = await ctx.db.insert("puzzles", {
        aggregateId,
        title,
        brand: "Ravensburger",
        pieceCount: 1000,
        searchableText: title.toLowerCase(),
        status: "approved",
        submittedBy: alice,
        createdAt: BASE,
        updatedAt: BASE,
      });
      return { id, aggregateId };
    };
    const vista = await mkPuzzle("Mountain Vista");
    const harbour = await mkPuzzle("Harbour Lights");
    const desert = await mkPuzzle("Desert Bloom");
    return { alice, bob, noah, vista, harbour, desert };
  });

type World = Awaited<ReturnType<typeof seedWorld>>;

const insertCopy = (
  t: T,
  spec: {
    ownerId: Id<"users">;
    puzzleId: Id<"puzzles">;
    availability?: Avail;
    visibility?: "private" | "visible";
  },
) =>
  t.run((ctx) =>
    ctx.db.insert("ownedPuzzles", {
      aggregateId: crypto.randomUUID(),
      puzzleId: spec.puzzleId,
      ownerId: spec.ownerId,
      condition: "good",
      availability: spec.availability ?? CLOSED,
      ...(spec.visibility && {
        visibility: spec.visibility,
        visibilityAuthoritative: true,
      }),
      createdAt: BASE,
      updatedAt: BASE,
    }),
  );

// A finished solve, against the definition, a copy, or both.
const insertCompletion = (
  t: T,
  spec: {
    userId: Id<"users">;
    puzzleId?: Id<"puzzles">;
    ownedPuzzleId?: Id<"ownedPuzzles">;
    days?: number;
    isCompleted?: boolean;
  },
) =>
  t.run((ctx) =>
    ctx.db.insert("completions", {
      aggregateId: crypto.randomUUID(),
      userId: spec.userId,
      puzzleId: spec.puzzleId,
      ownedPuzzleId: spec.ownedPuzzleId,
      startDate: BASE,
      endDate: BASE + (spec.days ?? 1) * DAY,
      completionTimeMinutes: (spec.days ?? 1) * 1440,
      photos: [],
      isCompleted: spec.isCompleted ?? true,
      createdAt: BASE,
      updatedAt: BASE,
    }),
  );

const insertReview = (
  t: T,
  spec: { userId: Id<"users">; puzzleId: Id<"puzzles">; rating?: number },
) =>
  t.run((ctx) =>
    ctx.db.insert("puzzleReviews", {
      userId: spec.userId,
      puzzleId: spec.puzzleId,
      rating: spec.rating,
      text: spec.rating === undefined ? "Migrated text-only review" : undefined,
      createdAt: BASE,
      updatedAt: BASE,
    }),
  );

// Every kind of source row the aggregates read, on `vista`:
//  - reviews: 5 and 3 stars, plus a migrated text-only one (never aggregates);
//  - completions: one on the definition (2 days), one only on alice's copy (4 days), an
//    in-progress one (never counts);
//  - copies: alice open forTrade, bob open forLend plus a PRIVATE closed copy, noah (private
//    profile) open forSale, and carol, whose only copy is private.
const seedScenario = async (t: T, w: World) => {
  const aliceCopy = await insertCopy(t, {
    ownerId: w.alice,
    puzzleId: w.vista.id,
    availability: { forTrade: true, forSale: false, forLend: false },
  });
  await insertCopy(t, {
    ownerId: w.bob,
    puzzleId: w.vista.id,
    availability: { forTrade: false, forSale: false, forLend: true },
  });
  await insertCopy(t, {
    ownerId: w.bob,
    puzzleId: w.vista.id,
    visibility: "private",
  });
  await insertCopy(t, {
    ownerId: w.noah,
    puzzleId: w.vista.id,
    availability: { forTrade: false, forSale: true, forLend: false },
  });
  const carol = await t.run((ctx) =>
    ctx.db.insert("users", {
      clerkId: "clerk_carol",
      email: "carol@example.com",
      name: "carol",
      isActive: true,
      createdAt: BASE,
      updatedAt: BASE,
    }),
  );
  await insertCopy(t, {
    ownerId: carol,
    puzzleId: w.vista.id,
    visibility: "private",
  });
  await insertReview(t, { userId: w.alice, puzzleId: w.vista.id, rating: 5 });
  await insertReview(t, { userId: w.bob, puzzleId: w.vista.id, rating: 3 });
  await insertReview(t, { userId: w.noah, puzzleId: w.vista.id });
  await insertCompletion(t, { userId: w.bob, puzzleId: w.vista.id, days: 2 });
  await insertCompletion(t, {
    userId: w.alice,
    ownedPuzzleId: aliceCopy,
    days: 4,
  });
  await insertCompletion(t, {
    userId: w.noah,
    puzzleId: w.vista.id,
    isCompleted: false,
  });
  return { aliceCopy, carol };
};

const statsRow = (t: T, puzzleId: Id<"puzzles">) =>
  t.run((ctx) =>
    ctx.db
      .query("definitionStats")
      .withIndex("by_puzzle", (q) => q.eq("puzzleId", puzzleId))
      .unique(),
  );

const liveTotals = (t: T, puzzleId: Id<"puzzles">) =>
  t.run((ctx) => computeDefinitionTotals(ctx, puzzleId));

const reconcile = async (t: T, args: { batchSize?: number } = {}) => {
  await t.mutation(internal.library.definitionStats.reconcile, args);
  await settle(t);
};

// The stored row is settled and equals what the live helpers compute from source now.
const expectInStep = async (t: T, puzzleId: Id<"puzzles">) => {
  await settle(t);
  const row = await statsRow(t, puzzleId);
  expect(row?.stale).toBeUndefined();
  expect(row?.totals).toEqual(await liveTotals(t, puzzleId));
  return row!.totals!;
};

const recomputeJobs = (t: T) =>
  t.run(async (ctx) =>
    (await ctx.db.system.query("_scheduled_functions").collect()).filter(
      (job) => job.name.includes("definitionStats:recompute"),
    ),
  );

describe("definitionStats backfill and nightly reconcile", () => {
  test("writes one row per definition with the live aggregates", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await seedScenario(t, w);

    await reconcile(t, { batchSize: 1 });

    const vista = await expectInStep(t, w.vista.id);
    expect(vista).toEqual({
      ratingCount: 2,
      ratingSum: 8,
      breakdown: [1, 0, 1, 0, 0],
      completedCount: 2,
      finishDaysSum: 6,
      finishDaysCount: 2,
      // alice, bob (their open copy is visible) and noah; carol holds only a private copy.
      communityOwners: 3,
      // noah's profile is private, so his copy for sale is not counted publicly.
      publicAvailable: { swap: 1, lend: 1, sale: 0 },
    });
    expect(await expectInStep(t, w.harbour.id)).toEqual({
      ratingCount: 0,
      ratingSum: 0,
      breakdown: [0, 0, 0, 0, 0],
      completedCount: 0,
      finishDaysSum: 0,
      finishDaysCount: 0,
      communityOwners: 0,
      publicAvailable: { swap: 0, lend: 0, sale: 0 },
    });
  });

  test("a re-run writes nothing", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await seedScenario(t, w);
    await reconcile(t);
    const before = await t.run((ctx) =>
      ctx.db.query("definitionStats").collect(),
    );

    await reconcile(t);

    expect(
      await t.run((ctx) => ctx.db.query("definitionStats").collect()),
    ).toEqual(before);
  });

  test("repairs a row that drifted from its sources", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await seedScenario(t, w);
    await reconcile(t);
    const row = await statsRow(t, w.vista.id);
    await t.run((ctx) =>
      ctx.db.patch(row!._id, {
        totals: { ...row!.totals!, communityOwners: 99, ratingSum: 1 },
      }),
    );

    await reconcile(t);

    expect((await expectInStep(t, w.vista.id)).communityOwners).toBe(3);
    expect(logs.some((line) => line.includes("definitionStats.drift"))).toBe(
      true,
    );
  });

  test("drops the row of a definition that no longer exists", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await reconcile(t);
    await t.run((ctx) => ctx.db.delete(w.harbour.id));

    await t.mutation(internal.library.definitionStats.recompute, {
      puzzleId: w.harbour.id,
    });

    expect(await statsRow(t, w.harbour.id)).toBeNull();
  });
});

describe("every write that changes a definition's aggregates marks it", () => {
  const acquire = async (t: T, who: string, puzzleDefinitionId: string) =>
    (await asUser(t, who).mutation(api.library.acquireCopy.acquireCopy, {
      puzzleDefinitionId,
      condition: "good",
    })) as string;

  const share = (
    t: T,
    who: string,
    copyId: string,
    sharing: {
      visibility: "private" | "visible";
      forTrade?: boolean;
      forSale?: boolean;
      forLend?: boolean;
    },
  ) =>
    asUser(t, who).mutation(api.library.updateCopySharing.updateCopySharing, {
      copyId,
      ...sharing,
    });

  test("a definition without a row gets one from its first write, scheduled once per transaction", async () => {
    const t = newT();
    const w = await seedWorld(t);

    await asUser(t, "alice").mutation(api.library.acquireCopies.acquireCopies, {
      items: [
        { puzzleDefinitionId: w.vista.aggregateId },
        { puzzleDefinitionId: w.vista.aggregateId },
        { puzzleDefinitionId: w.vista.aggregateId },
      ],
    });
    expect(await recomputeJobs(t)).toHaveLength(1);

    expect((await expectInStep(t, w.vista.id)).communityOwners).toBe(1);
  });

  test("acquire, sharing and visibility changes, and copy deletion", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await reconcile(t);

    const copyId = await acquire(t, "alice", w.vista.aggregateId);
    expect((await expectInStep(t, w.vista.id)).communityOwners).toBe(1);

    await share(t, "alice", copyId, { visibility: "visible", forTrade: true });
    expect((await expectInStep(t, w.vista.id)).publicAvailable).toEqual({
      swap: 1,
      lend: 0,
      sale: 0,
    });

    await share(t, "alice", copyId, { visibility: "private" });
    const hidden = await expectInStep(t, w.vista.id);
    expect(hidden.communityOwners).toBe(0);
    expect(hidden.publicAvailable.swap).toBe(0);

    await share(t, "alice", copyId, { visibility: "visible" });
    expect((await expectInStep(t, w.vista.id)).communityOwners).toBe(1);

    await asUser(t, "alice").mutation(api.library.deleteCopy.deleteCopy, {
      copyId,
    });
    expect((await expectInStep(t, w.vista.id)).communityOwners).toBe(0);
  });

  test("a copy edit that leaves the aggregates alone schedules no recompute", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const copyId = await acquire(t, "alice", w.vista.aggregateId);
    await reconcile(t);
    const jobs = (await recomputeJobs(t)).length;

    await asUser(t, "alice").mutation(
      api.library.updateCopyDetails.updateCopyDetails,
      { copyId, notes: "Box corner dented" },
    );
    await settle(t);

    expect(await recomputeJobs(t)).toHaveLength(jobs);
    expect((await statsRow(t, w.vista.id))?.stale).toBeUndefined();
  });

  test("recording, editing and deleting a completion", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const copyId = await acquire(t, "alice", w.vista.aggregateId);
    await reconcile(t);
    const now = Date.now();

    const { completionId } = (await asUser(t, "alice").mutation(
      api.solving.recordCompletion.recordCompletion,
      { copyId, startDate: now - 3 * DAY, endDate: now - HOUR },
    )) as { completionId: string };
    const recorded = await expectInStep(t, w.vista.id);
    expect(recorded.completedCount).toBe(1);

    await asUser(t, "alice").mutation(
      api.solving.editCompletion.editCompletion,
      { completionId, completionTimeMinutes: 10 * 1440 },
    );
    const edited = await expectInStep(t, w.vista.id);
    expect(edited.finishDaysSum).toBe(10);

    // A solve logged against the definition only (no copy).
    await asUser(t, "bob").mutation(
      api.solving.recordCompletion.recordCompletion,
      {
        puzzleDefinitionId: w.vista.aggregateId,
        startDate: now - 2 * DAY,
        endDate: now - HOUR,
      },
    );
    expect((await expectInStep(t, w.vista.id)).completedCount).toBe(2);

    await asUser(t, "alice").mutation(
      api.solving.deleteCompletion.deleteCompletion,
      { completionId },
    );
    expect((await expectInStep(t, w.vista.id)).completedCount).toBe(1);
  });

  test("posting and changing a review", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await reconcile(t);

    await asUser(t, "alice").mutation(
      api.social.postPuzzleReview.postPuzzleReview,
      { puzzleId: w.vista.id, rating: 4 },
    );
    expect((await expectInStep(t, w.vista.id)).ratingSum).toBe(4);

    await asUser(t, "alice").mutation(
      api.social.postPuzzleReview.postPuzzleReview,
      { puzzleId: w.vista.id, rating: 2, text: "Changed my mind" },
    );
    const changed = await expectInStep(t, w.vista.id);
    expect(changed.ratingCount).toBe(1);
    expect(changed.breakdown).toEqual([0, 0, 0, 1, 0]);
  });

  test("a member deleting their review, and the operator's removal of a member's reviews", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await insertReview(t, { userId: w.alice, puzzleId: w.vista.id, rating: 5 });
    await insertReview(t, { userId: w.bob, puzzleId: w.vista.id, rating: 3 });
    await reconcile(t);
    expect((await expectInStep(t, w.vista.id)).ratingCount).toBe(2);

    await asUser(t, "alice").mutation(
      api.social.deletePuzzleReview.deletePuzzleReview,
      { puzzleId: w.vista.id },
    );
    const afterDelete = await expectInStep(t, w.vista.id);
    expect(afterDelete.ratingCount).toBe(1);
    expect(afterDelete.ratingSum).toBe(3);

    await t.mutation(internal.social.removeMemberContent.removeMemberContent, {
      memberId: w.bob,
      dryRun: false,
      table: "puzzleReviews",
    });
    expect((await expectInStep(t, w.vista.id)).ratingCount).toBe(0);
  });

  test("a profile visibility change re-counts the definitions of the member's open copies", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const vistaCopy = await acquire(t, "alice", w.vista.aggregateId);
    const harbourCopy = await acquire(t, "alice", w.harbour.aggregateId);
    await share(t, "alice", vistaCopy, {
      visibility: "visible",
      forTrade: true,
    });
    await share(t, "alice", harbourCopy, {
      visibility: "visible",
      forSale: true,
    });
    await reconcile(t);
    expect((await statsRow(t, w.vista.id))?.totals?.publicAvailable.swap).toBe(
      1,
    );

    await asUser(t, "alice").mutation(
      api.social.setProfileVisibility.setProfileVisibility,
      { visibility: "private" },
    );
    expect((await expectInStep(t, w.vista.id)).publicAvailable.swap).toBe(0);
    expect((await expectInStep(t, w.harbour.id)).publicAvailable.sale).toBe(0);

    await asUser(t, "alice").mutation(
      api.social.setProfileVisibility.setProfileVisibility,
      { visibility: "public" },
    );
    expect((await expectInStep(t, w.vista.id)).publicAvailable.swap).toBe(1);
  });

  // A settled exchange: the copy leaves the market in the settling transaction
  // (exchange/adapters/inProcessEventPublisher); a sale or swap also moves it to the buyer.
  const settleExchange = async (
    t: T,
    type: "sale" | "loan",
    copyAggregateId: string,
  ) => {
    const copy = await t.run((ctx) =>
      ctx.db
        .query("ownedPuzzles")
        .withIndex("by_aggregate_id", (q) =>
          q.eq("aggregateId", copyAggregateId),
        )
        .unique(),
    );
    const exchangeId = await asUser(t, "bob").mutation(
      api.exchange.propose.propose,
      {
        type,
        requestedPuzzleId: copy!._id,
        ...(type === "sale" && { salePrice: 1000 }),
      },
    );
    await asUser(t, "alice").mutation(api.exchange.accept.accept, {
      exchangeId,
    });
    await asUser(t, "bob").mutation(
      api.exchange.confirmCompletion.confirmCompletion,
      { exchangeId },
    );
    await asUser(t, "alice").mutation(
      api.exchange.confirmCompletion.confirmCompletion,
      { exchangeId },
    );
  };

  test("a settled sale takes the copy off the market and moves it", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const copyAggregateId = await acquire(t, "alice", w.vista.aggregateId);
    await share(t, "alice", copyAggregateId, {
      visibility: "visible",
      forSale: true,
    });
    await reconcile(t);
    expect((await statsRow(t, w.vista.id))?.totals?.publicAvailable.sale).toBe(
      1,
    );

    await settleExchange(t, "sale", copyAggregateId);

    const settled = await expectInStep(t, w.vista.id);
    expect(settled.publicAvailable.sale).toBe(0);
    expect(settled.communityOwners).toBe(1);
  });

  test("a settled loan takes the copy off the market", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const copyAggregateId = await acquire(t, "alice", w.vista.aggregateId);
    await share(t, "alice", copyAggregateId, {
      visibility: "visible",
      forLend: true,
    });
    await reconcile(t);
    expect((await statsRow(t, w.vista.id))?.totals?.publicAvailable.lend).toBe(
      1,
    );

    await settleExchange(t, "loan", copyAggregateId);

    expect((await expectInStep(t, w.vista.id)).publicAvailable.lend).toBe(0);
  });

  test("an account purge removes the member's copies and solves from the aggregates", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const now = Date.now();
    const solve = { startDate: now - 2 * DAY, endDate: now - HOUR };
    // vista: a copy with a solve on it; harbour: a copy only; desert: a solve on the definition.
    const vistaCopy = await acquire(t, "alice", w.vista.aggregateId);
    await asUser(t, "alice").mutation(
      api.solving.recordCompletion.recordCompletion,
      { copyId: vistaCopy, ...solve },
    );
    await acquire(t, "alice", w.harbour.aggregateId);
    await asUser(t, "alice").mutation(
      api.solving.recordCompletion.recordCompletion,
      { puzzleDefinitionId: w.desert.aggregateId, ...solve },
    );
    await reconcile(t);
    expect((await statsRow(t, w.vista.id))?.totals?.completedCount).toBe(1);

    await t.mutation(
      internal.conversation.purgeMemberMessagingData.purgeMemberMessagingData,
      { memberId: w.alice },
    );

    const vista = await expectInStep(t, w.vista.id);
    expect(vista.communityOwners).toBe(0);
    expect(vista.completedCount).toBe(0);
    expect((await expectInStep(t, w.harbour.id)).communityOwners).toBe(0);
    expect((await expectInStep(t, w.desert.id)).completedCount).toBe(0);
  });
});
