import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);
const HOUR = 60 * 60 * 1000;

// Seed: alice owns a copy; bob and carol exist. Follow edges are inserted per-test.
const seed = async (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (name: string) =>
      ctx.db.insert("users", {
        clerkId: `clerk_${name}`,
        email: `${name}@example.com`,
        name,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const alice = await mkUser("alice");
    const bob = await mkUser("bob");
    const carol = await mkUser("carol");
    const puzzleAggregateId = crypto.randomUUID();
    const puzzleId = await ctx.db.insert("puzzles", {
      aggregateId: puzzleAggregateId,
      title: "Mountain Vista",
      brand: "Ravensburger",
      pieceCount: 1000,
      searchableText: "Mountain Vista Ravensburger",
      status: "approved",
      submittedBy: alice,
      createdAt: now,
      updatedAt: now,
    });
    const copyAggregateId = crypto.randomUUID();
    await ctx.db.insert("ownedPuzzles", {
      aggregateId: copyAggregateId,
      puzzleDefinitionId: puzzleAggregateId,
      puzzleId,
      ownerId: alice,
      condition: "good",
      availability: { forTrade: false, forSale: false, forLend: false },
      visibility: "private",
      createdAt: now,
      updatedAt: now,
    });
    return { alice, bob, carol, copyAggregateId };
  });

const asUser = (t: ReturnType<typeof convexTest>, name: string) =>
  t.withIdentity({ subject: `clerk_${name}` });

const follow = (
  t: ReturnType<typeof convexTest>,
  follower: Id<"users">,
  followee: Id<"users">,
) =>
  t.run(async (ctx) => {
    await ctx.db.insert("follows", {
      followerId: follower,
      followeeId: followee,
      createdAt: Date.now(),
    });
  });

describe("social.getActivityFeed — started entries", () => {
  test("shows a followee's start only when they opted in AND are mutual", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, copyAggregateId } = await seed(t);
    await follow(t, bob, alice); // bob follows alice (one-way for now)

    await asUser(t, "alice").mutation(
      api.solving.startCompletion.startCompletion,
      { copyId: copyAggregateId, startDate: Date.now() - HOUR },
    );

    // Not opted in -> hidden.
    let feed = await asUser(t, "bob").query(
      api.social.getActivityFeed.getActivityFeed,
      {},
    );
    expect(feed.filter((e) => e.kind === "started")).toHaveLength(0);

    // Opted in but NOT mutual -> still hidden (friends-only, decided in review).
    await asUser(t, "alice").mutation(
      api.solving.setShareInProgress.setShareInProgress,
      { enabled: true },
    );
    feed = await asUser(t, "bob").query(
      api.social.getActivityFeed.getActivityFeed,
      {},
    );
    expect(feed.filter((e) => e.kind === "started")).toHaveLength(0);

    // Mutual + opted in -> visible.
    await follow(t, alice, bob);
    feed = await asUser(t, "bob").query(
      api.social.getActivityFeed.getActivityFeed,
      {},
    );
    const started = feed.filter((e) => e.kind === "started");
    expect(started).toHaveLength(1);
    expect(started[0].memberId).toBe(alice);
  });

  test("the viewer's own starts always appear, regardless of preference", async () => {
    const t = convexTest(schema, modules);
    const { copyAggregateId } = await seed(t);
    await asUser(t, "alice").mutation(
      api.solving.startCompletion.startCompletion,
      { copyId: copyAggregateId, startDate: Date.now() - HOUR },
    );
    const feed = await asUser(t, "alice").query(
      api.social.getActivityFeed.getActivityFeed,
      {},
    );
    expect(feed.filter((e) => e.kind === "started")).toHaveLength(1);
  });

  test("future-dated starts are excluded from the feed (past-dated ones appear)", async () => {
    const t = convexTest(schema, modules);
    const { copyAggregateId } = await seed(t);
    await asUser(t, "alice").mutation(
      api.solving.setShareInProgress.setShareInProgress,
      { enabled: true },
    );
    await asUser(t, "alice").mutation(
      api.solving.startCompletion.startCompletion,
      { copyId: copyAggregateId, startDate: Date.now() + 24 * HOUR },
    );
    const pastId = (await asUser(t, "alice").mutation(
      api.solving.startCompletion.startCompletion,
      { copyId: copyAggregateId, startDate: Date.now() - HOUR },
    )) as string;
    const feed = await asUser(t, "alice").query(
      api.social.getActivityFeed.getActivityFeed,
      {},
    );
    // Positive control makes this test genuinely red pre-implementation: exactly the past-dated
    // start shows, the future-dated one does not.
    const started = feed.filter((e) => e.kind === "started");
    expect(started).toHaveLength(1);
    expect(started[0].ref).toBe(pastId);
  });

  test("finishing a started solve yields both a started and a completion entry (distinct kinds, same ref)", async () => {
    const t = convexTest(schema, modules);
    const { copyAggregateId } = await seed(t);
    const completionId = (await asUser(t, "alice").mutation(
      api.solving.startCompletion.startCompletion,
      { copyId: copyAggregateId, startDate: Date.now() - 2 * HOUR },
    )) as string;
    await asUser(t, "alice").mutation(
      api.solving.finishCompletion.finishCompletion,
      { completionId, endDate: Date.now() },
    );
    const feed = await asUser(t, "alice").query(
      api.social.getActivityFeed.getActivityFeed,
      {},
    );
    const entries = feed.filter((e) => e.ref === completionId);
    expect(entries).toHaveLength(2);
    expect(new Set(entries.map((e) => e.kind))).toEqual(
      new Set(["started", "completion"]),
    );
  });

  test("pages stay full-length when non-opted-in actors' starts are dropped (filter before slice)", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, carol, copyAggregateId } = await seed(t);
    // bob follows carol one-way; carol never opts in — her starts must be dropped.
    await follow(t, bob, carol);
    // bob↔alice mutual; alice opts in — her activity is visible.
    await follow(t, bob, alice);
    await follow(t, alice, bob);
    await asUser(t, "alice").mutation(
      api.solving.setShareInProgress.setShareInProgress,
      { enabled: true },
    );

    // ORDER MATTERS: the feed sorts by event PUBLISH time (occurredAt), not startDate. Alice's
    // visible starts must be published FIRST so carol's later (newer) dropped entries occupy the
    // top slice slots — that's what makes a drop-AFTER-slice bug return a short page here.
    for (const offset of [3, 2, 1]) {
      await asUser(t, "alice").mutation(
        api.solving.startCompletion.startCompletion,
        { copyId: copyAggregateId, startDate: Date.now() - offset * HOUR },
      );
    }
    // Then carol starts twice on the copy (lend it to her so the holder authz passes). Her two
    // CompletionStarted events are now the NEWEST in bob's raw window.
    await t.run(async (ctx) => {
      const copy = await ctx.db
        .query("ownedPuzzles")
        .withIndex("by_aggregate_id", (q) =>
          q.eq("aggregateId", copyAggregateId),
        )
        .unique();
      await ctx.db.patch(copy!._id, { heldBy: carol });
    });
    for (const offset of [5, 4]) {
      await asUser(t, "carol").mutation(
        api.solving.startCompletion.startCompletion,
        { copyId: copyAggregateId, startDate: Date.now() - offset * HOUR },
      );
    }

    // limit 3 < raw pool (5): drop-after-slice would slice [carol, carol, alice] then drop carol's
    // two → a 1-entry page. Filter-before-slice returns a full 3-entry page, all alice's.
    const feed = await asUser(t, "bob").query(
      api.social.getActivityFeed.getActivityFeed,
      { limit: 3 },
    );
    expect(feed).toHaveLength(3);
    expect(feed.every((e) => e.memberId === alice)).toBe(true);
  });
});
