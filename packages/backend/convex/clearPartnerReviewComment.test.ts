import { convexTest, type TestConvex } from "convex-test";
import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// SEC-70: after an exchange, the reviewer can take back the written comment on their partner
// review. The star ratings stay (they are the reviewee's reputation); only the reviewer can do it.

const seed = async (t: TestConvex<typeof schema>) =>
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
    const puzzleId = await ctx.db.insert("puzzles", {
      aggregateId: crypto.randomUUID(),
      title: "Mountain Vista",
      pieceCount: 1000,
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
      createdAt: now,
      updatedAt: now,
    });
    const exchangeAggregateId = crypto.randomUUID();
    const exchangeId = await ctx.db.insert("exchanges", {
      aggregateId: exchangeAggregateId,
      initiatorId: alice,
      recipientId: bob,
      type: "trade",
      requestedPuzzleId: ownedPuzzleId,
      status: "completed",
      createdAt: now,
      updatedAt: now,
    });
    return { alice, bob, exchangeId, exchangeAggregateId };
  });

const asAlice = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_alice" });
const asBob = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_bob" });

const codeOf = async (promise: Promise<unknown>): Promise<string | null> => {
  try {
    await promise;
    return null;
  } catch (error) {
    if (error instanceof ConvexError) {
      const data: unknown = error.data;
      if (typeof data === "object" && data !== null && "code" in data) {
        return String(data.code);
      }
      return String(data);
    }
    throw error;
  }
};

const scores = { communication: 3, packaging: 1, condition: 2, timeliness: 1 };

const aliceReviewsBob = (
  t: TestConvex<typeof schema>,
  exchangeAggregateId: string,
  bob: Id<"users">,
) =>
  asAlice(t).mutation(api.reputation.submitPartnerReview.submitPartnerReview, {
    exchangeId: exchangeAggregateId,
    revieweeId: bob,
    rating: 2,
    comment: "Arrived late, box crushed",
    scores,
  });

describe("clearPartnerReviewComment", () => {
  test("the reviewer removes the comment; ratings and the reviewee's reputation stay", async () => {
    const t = convexTest(schema, modules);
    const { bob, exchangeAggregateId } = await seed(t);
    await aliceReviewsBob(t, exchangeAggregateId, bob);
    const profileBefore = await t.run((ctx) =>
      ctx.db
        .query("reputationProfiles")
        .withIndex("by_member", (q) => q.eq("memberId", bob))
        .unique(),
    );

    const mine = await asAlice(t).query(
      api.reputation.getMyReviewForExchange.getMyReviewForExchange,
      { exchangeId: exchangeAggregateId },
    );
    expect(mine?.canClearComment).toBe(true);

    await asAlice(t).mutation(
      api.reputation.clearPartnerReviewComment.clearPartnerReviewComment,
      { exchangeId: exchangeAggregateId },
    );

    const [row] = await t.run((ctx) => ctx.db.query("reviews").collect());
    expect(row.comment).toBeUndefined();
    expect(row.rating).toBe(2);
    expect(row.categories).toEqual(scores);
    const profileAfter = await t.run((ctx) =>
      ctx.db
        .query("reputationProfiles")
        .withIndex("by_member", (q) => q.eq("memberId", bob))
        .unique(),
    );
    expect(profileAfter).toEqual(profileBefore);
    const afterwards = await asAlice(t).query(
      api.reputation.getMyReviewForExchange.getMyReviewForExchange,
      { exchangeId: exchangeAggregateId },
    );
    expect(afterwards?.canClearComment).toBe(false);
  });

  test("the reviewee cannot clear it, and a signed-out caller is refused", async () => {
    const t = convexTest(schema, modules);
    const { bob, exchangeAggregateId } = await seed(t);
    await aliceReviewsBob(t, exchangeAggregateId, bob);

    expect(
      await codeOf(
        asBob(t).mutation(
          api.reputation.clearPartnerReviewComment.clearPartnerReviewComment,
          { exchangeId: exchangeAggregateId },
        ),
      ),
    ).toBe("PartnerReviewNotFound");
    await expect(
      t.mutation(
        api.reputation.clearPartnerReviewComment.clearPartnerReviewComment,
        { exchangeId: exchangeAggregateId },
      ),
    ).rejects.toThrow();
    const [row] = await t.run((ctx) => ctx.db.query("reviews").collect());
    expect(row.comment).toBe("Arrived late, box crushed");
  });

  test("a legacy review row without an aggregateId is not offered for clearing", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, exchangeId, exchangeAggregateId } = await seed(t);
    await t.run((ctx) =>
      ctx.db.insert("reviews", {
        exchangeId,
        reviewerId: alice,
        revieweeId: bob,
        rating: 4,
        comment: "Written before aggregate ids",
        categories: {
          communication: 4,
          packaging: 4,
          condition: 4,
          timeliness: 4,
        },
        createdAt: Date.now(),
      }),
    );

    const mine = await asAlice(t).query(
      api.reputation.getMyReviewForExchange.getMyReviewForExchange,
      { exchangeId: exchangeAggregateId },
    );
    expect(mine).not.toBeNull();
    expect(mine?.canClearComment).toBe(false);
  });
});
