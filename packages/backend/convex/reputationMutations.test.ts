import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob("./**/!(*.test).*s");

const asUser = (t: ReturnType<typeof convexTest>, subject: string) =>
  t.withIdentity({ subject });

// Seed three members, an owned copy (for the exchanges' required FK), and a COMPLETED exchange
// between alice (initiator) and bob (recipient) carrying an aggregateId. Returns the ids plus the
// exchange's aggregateId, which the submit mutation takes as its `exchangeId` arg.
const seed = async (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (clerkId: string, name: string) =>
      ctx.db.insert("users", {
        clerkId,
        email: `${name}@example.com`,
        name,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const alice = await mkUser("clerk_alice", "alice");
    const bob = await mkUser("clerk_bob", "bob");
    const carol = await mkUser("clerk_carol", "carol");

    const puzzleId = await ctx.db.insert("puzzles", {
      aggregateId: crypto.randomUUID(),
      title: "Mountain Vista",
      brand: "Ravensburger",
      pieceCount: 1000,
      searchableText: "Mountain Vista Ravensburger",
      status: "approved",
      submittedBy: alice,
      createdAt: now,
      updatedAt: now,
    });
    const ownedPuzzleId = await ctx.db.insert("ownedPuzzles", {
      aggregateId: crypto.randomUUID(),
      puzzleId,
      ownerId: bob,
      condition: "good",
      availability: { forTrade: true, forSale: false, forLend: false },
      visibility: "visible",
      createdAt: now,
      updatedAt: now,
    });

    const mkExchange = (
      initiatorId: Id<"users">,
      recipientId: Id<"users">,
      status: "completed" | "proposed" | "accepted",
    ) => {
      const aggregateId = crypto.randomUUID();
      return ctx.db
        .insert("exchanges", {
          aggregateId,
          initiatorId,
          recipientId,
          type: "trade",
          requestedPuzzleId: ownedPuzzleId,
          status,
          createdAt: now,
          updatedAt: now,
        })
        .then((id) => ({ id, aggregateId }));
    };

    const completed = await mkExchange(alice, bob, "completed");
    const proposed = await mkExchange(alice, bob, "proposed");
    // A completed exchange NOT involving carol (alice<->bob); used for the non-participant case.

    return { alice, bob, carol, completed, proposed };
  });

// convex-test serializes ConvexError.data to a JSON string at the function boundary; normalise.
const dataOf = (e: unknown): { code?: string } => {
  const data = (e as ConvexError<unknown>).data;
  return typeof data === "string"
    ? JSON.parse(data)
    : (data as { code?: string });
};

const expectConvexCode = async (p: Promise<unknown>, code: string) => {
  await expect(p).rejects.toBeInstanceOf(ConvexError);
  await p.catch((e: unknown) => {
    expect(dataOf(e).code).toBe(code);
  });
};

const reviewRow = (t: ReturnType<typeof convexTest>, aggregateId: string) =>
  t.run(async (ctx) =>
    ctx.db
      .query("reviews")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", aggregateId))
      .unique(),
  );

const profileRow = (t: ReturnType<typeof convexTest>, memberId: Id<"users">) =>
  t.run(async (ctx) =>
    ctx.db
      .query("reputationProfiles")
      .withIndex("by_member", (q) => q.eq("memberId", memberId))
      .unique(),
  );

const goodScores = {
  communication: 5,
  packaging: 4,
  condition: 5,
  timeliness: 4,
};

describe("reputation.submitPartnerReview", () => {
  test("requires authentication", async () => {
    const t = convexTest(schema, modules);
    const { bob, completed } = await seed(t);
    await expect(
      t.mutation(api.reputation.submitPartnerReview.submitPartnerReview, {
        exchangeId: completed.aggregateId,
        revieweeId: bob,
        rating: 5,
        scores: goodScores,
      }),
    ).rejects.toThrow("Unauthenticated");
  });

  test("submits a review: saved with resolved FKs, profile recomputed for the reviewee", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, completed } = await seed(t);
    const reviewId = (await asUser(t, "clerk_alice").mutation(
      api.reputation.submitPartnerReview.submitPartnerReview,
      {
        exchangeId: completed.aggregateId,
        revieweeId: bob,
        rating: 5,
        comment: "Great trader",
        scores: goodScores,
      },
    )) as string;
    expect(typeof reviewId).toBe("string");

    const row = await reviewRow(t, reviewId);
    expect(row?.reviewerId).toBe(alice); // from auth, not args
    expect(row?.revieweeId).toBe(bob);
    expect(row?.exchangeId).toBe(completed.id); // aggregateId resolved to the FK _id
    expect(row?.rating).toBe(5);
    expect(row?.categories.communication).toBe(5);

    // The reviewee's profile was folded and saved in the same transaction.
    const profile = await profileRow(t, bob);
    expect(profile?.reviewCount).toBe(1);
    expect(profile?.averageRating).toBe(5);
    expect(profile?.ratingSum).toBe(5);
    expect(profile?.credibility).toBeCloseTo(0.1);
  });

  test("a member cannot review themselves => SelfReview", async () => {
    const t = convexTest(schema, modules);
    const { alice, completed } = await seed(t);
    await expectConvexCode(
      asUser(t, "clerk_alice").mutation(
        api.reputation.submitPartnerReview.submitPartnerReview,
        {
          exchangeId: completed.aggregateId,
          revieweeId: alice,
          rating: 5,
          scores: goodScores,
        },
      ),
      "SelfReview",
    );
  });

  test("an exchange that is not completed => ExchangeNotCompleted", async () => {
    const t = convexTest(schema, modules);
    const { bob, proposed } = await seed(t);
    await expectConvexCode(
      asUser(t, "clerk_alice").mutation(
        api.reputation.submitPartnerReview.submitPartnerReview,
        {
          exchangeId: proposed.aggregateId,
          revieweeId: bob,
          rating: 5,
          scores: goodScores,
        },
      ),
      "ExchangeNotCompleted",
    );
  });

  test("a non-participant cannot review => ExchangeNotCompleted (no window)", async () => {
    const t = convexTest(schema, modules);
    const { bob, carol, completed } = await seed(t);
    // Carol was not a party to the alice<->bob exchange; the completion port returns false.
    await expectConvexCode(
      asUser(t, "clerk_carol").mutation(
        api.reputation.submitPartnerReview.submitPartnerReview,
        {
          exchangeId: completed.aggregateId,
          revieweeId: bob,
          rating: 5,
          scores: goodScores,
        },
      ),
      "ExchangeNotCompleted",
    );
    // Also rejected when the reviewee is the non-party.
    await expectConvexCode(
      asUser(t, "clerk_alice").mutation(
        api.reputation.submitPartnerReview.submitPartnerReview,
        {
          exchangeId: completed.aggregateId,
          revieweeId: carol,
          rating: 5,
          scores: goodScores,
        },
      ),
      "ExchangeNotCompleted",
    );
  });

  test("a second review by the same reviewer on the same exchange => DuplicatePartnerReview", async () => {
    const t = convexTest(schema, modules);
    const { bob, completed } = await seed(t);
    await asUser(t, "clerk_alice").mutation(
      api.reputation.submitPartnerReview.submitPartnerReview,
      {
        exchangeId: completed.aggregateId,
        revieweeId: bob,
        rating: 5,
        scores: goodScores,
      },
    );
    await expectConvexCode(
      asUser(t, "clerk_alice").mutation(
        api.reputation.submitPartnerReview.submitPartnerReview,
        {
          exchangeId: completed.aggregateId,
          revieweeId: bob,
          rating: 3,
          scores: goodScores,
        },
      ),
      "DuplicatePartnerReview",
    );
  });

  test("a rating outside 1-5 => InvalidRating", async () => {
    const t = convexTest(schema, modules);
    const { bob, completed } = await seed(t);
    await expectConvexCode(
      asUser(t, "clerk_alice").mutation(
        api.reputation.submitPartnerReview.submitPartnerReview,
        {
          exchangeId: completed.aggregateId,
          revieweeId: bob,
          rating: 9,
          scores: goodScores,
        },
      ),
      "InvalidRating",
    );
  });

  test("the profile average is recomputed across multiple reviews", async () => {
    const t = convexTest(schema, modules);
    const { bob, completed, proposed } = await seed(t);
    // First review (alice -> bob, rating 5).
    await asUser(t, "clerk_alice").mutation(
      api.reputation.submitPartnerReview.submitPartnerReview,
      {
        exchangeId: completed.aggregateId,
        revieweeId: bob,
        rating: 5,
        scores: goodScores,
      },
    );
    // Make the second exchange completed so a different reviewer can review bob.
    await t.run(async (ctx) => {
      await ctx.db.patch(proposed.id, { status: "completed" });
    });
    // Second review (alice -> bob on a different exchange, rating 3) => average 4.
    await asUser(t, "clerk_alice").mutation(
      api.reputation.submitPartnerReview.submitPartnerReview,
      {
        exchangeId: proposed.aggregateId,
        revieweeId: bob,
        rating: 3,
        scores: goodScores,
      },
    );
    const profile = await profileRow(t, bob);
    expect(profile?.reviewCount).toBe(2);
    expect(profile?.ratingSum).toBe(8);
    expect(profile?.averageRating).toBe(4);
  });
});

describe("reputation read queries", () => {
  test("getReputationProfile returns a zero default for an unreviewed member", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    const profile = await asUser(t, "clerk_alice").query(
      api.reputation.getReputationProfile.getReputationProfile,
      { memberId: bob },
    );
    expect(profile.reviewCount).toBe(0);
    expect(profile.averageRating).toBe(0);
  });

  test("getReputationProfile surfaces the projection after a review", async () => {
    const t = convexTest(schema, modules);
    const { bob, completed } = await seed(t);
    await asUser(t, "clerk_alice").mutation(
      api.reputation.submitPartnerReview.submitPartnerReview,
      {
        exchangeId: completed.aggregateId,
        revieweeId: bob,
        rating: 4,
        scores: goodScores,
      },
    );
    const profile = await asUser(t, "clerk_alice").query(
      api.reputation.getReputationProfile.getReputationProfile,
      { memberId: bob },
    );
    expect(profile.reviewCount).toBe(1);
    expect(profile.averageRating).toBe(4);
  });

  test("listReviewsForMember returns reviews received by that member", async () => {
    const t = convexTest(schema, modules);
    const { bob, completed } = await seed(t);
    await asUser(t, "clerk_alice").mutation(
      api.reputation.submitPartnerReview.submitPartnerReview,
      {
        exchangeId: completed.aggregateId,
        revieweeId: bob,
        rating: 5,
        scores: goodScores,
      },
    );
    const reviews = await asUser(t, "clerk_alice").query(
      api.reputation.listReviewsForMember.listReviewsForMember,
      { memberId: bob },
    );
    expect(reviews).toHaveLength(1);
    expect(reviews[0]?.rating).toBe(5);
  });

  test("getMyReviewForExchange tells the caller whether they already reviewed", async () => {
    const t = convexTest(schema, modules);
    const { bob, completed } = await seed(t);
    const before = await asUser(t, "clerk_alice").query(
      api.reputation.getMyReviewForExchange.getMyReviewForExchange,
      { exchangeId: completed.aggregateId },
    );
    expect(before).toBeNull();

    await asUser(t, "clerk_alice").mutation(
      api.reputation.submitPartnerReview.submitPartnerReview,
      {
        exchangeId: completed.aggregateId,
        revieweeId: bob,
        rating: 5,
        scores: goodScores,
      },
    );
    const after = await asUser(t, "clerk_alice").query(
      api.reputation.getMyReviewForExchange.getMyReviewForExchange,
      { exchangeId: completed.aggregateId },
    );
    expect(after?.rating).toBe(5);
  });
});

describe("reputation.backfill", () => {
  test("stamps aggregateId on legacy reviews and rebuilds profiles from history", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, completed } = await seed(t);
    // Two legacy reviews about bob (no aggregateId), inserted directly to mimic historical data.
    await t.run(async (ctx) => {
      const base = {
        exchangeId: completed.id,
        reviewerId: alice,
        revieweeId: bob,
        comment: undefined,
        categories: {
          communication: 5,
          packaging: 5,
          condition: 5,
          timeliness: 5,
        },
        createdAt: Date.now(),
      };
      await ctx.db.insert("reviews", { ...base, rating: 5 });
      await ctx.db.insert("reviews", { ...base, rating: 3 });
    });

    const result = await t.mutation(
      internal.reputation.backfill.backfillReputation,
      {},
    );
    expect(result.reviewsStamped).toBe(2);
    expect(result.profilesUpserted).toBe(1);

    const profile = await profileRow(t, bob);
    expect(profile?.reviewCount).toBe(2);
    expect(profile?.ratingSum).toBe(8);
    expect(profile?.averageRating).toBe(4);

    // Idempotent: a second run stamps nothing new and recomputes the same projection.
    const again = await t.mutation(
      internal.reputation.backfill.backfillReputation,
      {},
    );
    expect(again.reviewsStamped).toBe(0);
    const profileAgain = await profileRow(t, bob);
    expect(profileAgain?.reviewCount).toBe(2);
  });
});
