import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { REMOVE_MEMBER_CONTENT_BATCH } from "./social/removeMemberContent";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// SEC-70: an operator handles a member's (or a deleted member's) request to remove what they
// wrote: their copy and photo comments, puzzle and copy reviews, and the written comment on their
// partner reviews (the ratings stay). Dry run by default; another member's content is never
// touched.

const T = 1_700_000_000_000;

type Seeded = {
  t: TestConvex<typeof schema>;
  alice: Id<"users">;
  bob: Id<"users">;
};

const seed = async (): Promise<Seeded> => {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const mkUser = (clerkId: string, name: string) =>
      ctx.db.insert("users", {
        clerkId,
        email: `${name}@example.com`,
        name,
        isActive: true,
        createdAt: T,
        updatedAt: T,
      });
    const alice = await mkUser("clerk_alice", "alice");
    const bob = await mkUser("clerk_bob", "bob");
    const puzzleId = await ctx.db.insert("puzzles", {
      title: "Mountain Vista",
      pieceCount: 1000,
      status: "approved",
      submittedBy: alice,
      createdAt: T,
      updatedAt: T,
    });
    const copy = await ctx.db.insert("ownedPuzzles", {
      puzzleId,
      ownerId: bob,
      condition: "good",
      availability: { forTrade: true, forSale: false, forLend: false },
      createdAt: T,
      updatedAt: T,
    });
    const photoId = await ctx.db.insert("ownedPuzzleImages", {
      ownedPuzzleId: copy,
      uploaderId: bob,
      fileId: await ctx.storage.store(new Blob(["img"])),
      createdAt: T,
      updatedAt: T,
    });
    const exchangeId = await ctx.db.insert("exchanges", {
      initiatorId: alice,
      recipientId: bob,
      type: "trade",
      requestedPuzzleId: copy,
      status: "completed",
      createdAt: T,
      updatedAt: T,
    });
    for (const authorId of [alice, bob]) {
      await ctx.db.insert("puzzleComments", {
        puzzleId,
        copyId: copy,
        authorId,
        text: `note by ${authorId}`,
        createdAt: T,
      });
      await ctx.db.insert("photoComments", {
        photoId,
        authorId,
        text: `photo comment by ${authorId}`,
        createdAt: T,
      });
      await ctx.db.insert("puzzleReviews", {
        userId: authorId,
        puzzleId,
        rating: 4,
        text: `review by ${authorId}`,
        createdAt: T,
        updatedAt: T,
      });
      await ctx.db.insert("copyReviews", {
        userId: authorId,
        copyId: copy,
        rating: 3,
        createdAt: T,
        updatedAt: T,
      });
      await ctx.db.insert("reviews", {
        exchangeId,
        reviewerId: authorId,
        revieweeId: authorId === alice ? bob : alice,
        rating: 2,
        comment: `partner comment by ${authorId}`,
        categories: {
          communication: 2,
          packaging: 2,
          condition: 2,
          timeliness: 2,
        },
        createdAt: T,
      });
    }
    return { alice, bob };
  });
  return { t, ...ids };
};

// Every member-authored row, keyed by table, as the authors and texts left in them.
const snapshot = (s: Seeded) =>
  s.t.run(async (ctx) => ({
    puzzleComments: (await ctx.db.query("puzzleComments").collect()).map(
      (r) => r.authorId,
    ),
    photoComments: (await ctx.db.query("photoComments").collect()).map(
      (r) => r.authorId,
    ),
    puzzleReviews: (await ctx.db.query("puzzleReviews").collect()).map(
      (r) => r.userId,
    ),
    copyReviews: (await ctx.db.query("copyReviews").collect()).map(
      (r) => r.userId,
    ),
    reviews: (await ctx.db.query("reviews").collect()).map((r) => ({
      reviewerId: r.reviewerId,
      rating: r.rating,
      comment: r.comment ?? null,
    })),
  }));

describe("removeMemberContent", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test("is a dry run by default: it counts and changes nothing", async () => {
    const s = await seed();
    const before = await snapshot(s);

    await s.t.mutation(
      internal.social.removeMemberContent.removeMemberContent,
      {
        memberId: s.alice,
      },
    );
    await s.t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(await snapshot(s)).toEqual(before);
  });

  test("removes everything the member wrote, keeps their ratings of partners and everyone else's content", async () => {
    const s = await seed();

    await s.t.mutation(
      internal.social.removeMemberContent.removeMemberContent,
      {
        memberId: s.alice,
        dryRun: false,
      },
    );
    await s.t.finishAllScheduledFunctions(vi.runAllTimers);

    const after = await snapshot(s);
    expect(after.puzzleComments).toEqual([s.bob]);
    expect(after.photoComments).toEqual([s.bob]);
    expect(after.puzzleReviews).toEqual([s.bob]);
    expect(after.copyReviews).toEqual([s.bob]);
    expect(after.reviews).toEqual([
      { reviewerId: s.alice, rating: 2, comment: null },
      { reviewerId: s.bob, rating: 2, comment: `partner comment by ${s.bob}` },
    ]);
  });

  test("works for a member whose account is already gone, and pages past one batch", async () => {
    const s = await seed();
    await s.t.run(async (ctx) => {
      const [one] = await ctx.db.query("puzzleComments").collect();
      for (let i = 0; i < REMOVE_MEMBER_CONTENT_BATCH + 2; i++) {
        await ctx.db.insert("puzzleComments", {
          puzzleId: one.puzzleId,
          copyId: one.copyId,
          authorId: s.alice,
          text: `more ${i}`,
          createdAt: T + i,
        });
      }
      await ctx.db.delete(s.alice);
    });

    await s.t.mutation(
      internal.social.removeMemberContent.removeMemberContent,
      {
        memberId: s.alice,
        dryRun: false,
      },
    );
    await s.t.finishAllScheduledFunctions(vi.runAllTimers);

    const after = await snapshot(s);
    expect(after.puzzleComments).toEqual([s.bob]);
    expect(after.photoComments).toEqual([s.bob]);
    expect(after.puzzleReviews).toEqual([s.bob]);
    expect(after.copyReviews).toEqual([s.bob]);
    expect(after.reviews.map((r) => r.comment)).toEqual([
      null,
      `partner comment by ${s.bob}`,
    ]);
  });
});
