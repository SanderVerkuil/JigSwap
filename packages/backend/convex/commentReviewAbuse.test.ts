import { convexTest, type TestConvex } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// SEC-28 (review repros LIB-6 and SOC-13): photo comments, copy comments and puzzle reviews took
// text of any length, so a harasser could post 50 KB comments under a member's photo and a
// spammer near-1 MB reviews that every catalogue visitor loads.

type T = TestConvex<typeof schema>;

const asAlice = (t: T) => t.withIdentity({ subject: "clerk_alice" });
const asBob = (t: T) => t.withIdentity({ subject: "clerk_bob" });

// Alice (public profile, the default) owns an OPEN copy of an approved puzzle, with one legacy
// photo (no moderation status = approved), so any member may see and discuss it (canViewCopy).
const seed = (t: T) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (clerkId: string, name: string) =>
      ctx.db.insert("users", {
        clerkId,
        email: `${clerkId}@example.com`,
        name,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const alice = await mkUser("clerk_alice", "Alice");
    const bob = await mkUser("clerk_bob", "Bob");
    const puzzleId = await ctx.db.insert("puzzles", {
      aggregateId: crypto.randomUUID(),
      title: "Mountain Vista",
      pieceCount: 1000,
      status: "approved",
      submittedBy: alice,
      createdAt: now,
      updatedAt: now,
    });
    const copyId = await ctx.db.insert("ownedPuzzles", {
      puzzleId,
      ownerId: alice,
      condition: "good",
      availability: { forTrade: true, forSale: false, forLend: false },
      createdAt: now,
      updatedAt: now,
    });
    const fileId = await ctx.storage.store(
      new Blob(["fake-image-bytes"], { type: "image/png" }),
    );
    const photoId = await ctx.db.insert("ownedPuzzleImages", {
      ownedPuzzleId: copyId,
      uploaderId: alice,
      fileId,
      tag: "box_front",
      createdAt: now,
      updatedAt: now,
    });
    return { alice, bob, puzzleId, copyId, photoId };
  });

const codeOf = async (p: Promise<unknown>): Promise<string | undefined> => {
  const e = await p.then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(e).toBeInstanceOf(ConvexError);
  const data = (e as ConvexError<Value>).data;
  return typeof data === "object" && data !== null && "code" in data
    ? String(data.code)
    : undefined;
};

const countRows = (
  t: T,
  table: "photoComments" | "puzzleComments" | "puzzleReviews",
) => t.run(async (ctx) => (await ctx.db.query(table).collect()).length);

describe("comment and review text caps (SEC-28)", () => {
  test("a 50 KB photo comment is refused; 1000 characters is accepted", async () => {
    const t = convexTest(schema, modules);
    const { photoId } = await seed(t);

    expect(
      await codeOf(
        asBob(t).mutation(api.library.postPhotoComment.postPhotoComment, {
          photoId,
          text: "A".repeat(50_000),
        }),
      ),
    ).toBe("CommentTextTooLong");
    expect(await countRows(t, "photoComments")).toBe(0);

    await asBob(t).mutation(api.library.postPhotoComment.postPhotoComment, {
      photoId,
      text: "A".repeat(1000),
    });
    expect(await countRows(t, "photoComments")).toBe(1);
  });

  test("a copy comment over 1000 characters is refused", async () => {
    const t = convexTest(schema, modules);
    const { copyId } = await seed(t);

    expect(
      await codeOf(
        asAlice(t).mutation(api.social.postPuzzleComment.postPuzzleComment, {
          copyId,
          text: "A".repeat(1001),
        }),
      ),
    ).toBe("CommentTextTooLong");
    expect(await countRows(t, "puzzleComments")).toBe(0);
  });

  test("a 360 KB review is refused by postPuzzleReview; 2000 characters is accepted", async () => {
    const t = convexTest(schema, modules);
    const { puzzleId } = await seed(t);

    expect(
      await codeOf(
        asBob(t).mutation(api.social.postPuzzleReview.postPuzzleReview, {
          puzzleId,
          rating: 1,
          text: "BUY CHEAP PUZZLES ".repeat(20_000),
        }),
      ),
    ).toBe("ReviewTextTooLong");
    expect(await countRows(t, "puzzleReviews")).toBe(0);

    await asBob(t).mutation(api.social.postPuzzleReview.postPuzzleReview, {
      puzzleId,
      rating: 4,
      text: "A".repeat(2000),
    });
    expect(await countRows(t, "puzzleReviews")).toBe(1);
  });

  test("submitReviews refuses puzzle review text over 2000 characters", async () => {
    const t = convexTest(schema, modules);
    const { puzzleId } = await seed(t);

    expect(
      await codeOf(
        asBob(t).mutation(api.solving.submitReviews.submitReviews, {
          puzzleId,
          puzzle: { rating: 1, text: "A".repeat(2001) },
        }),
      ),
    ).toBe("ReviewTextTooLong");
    expect(await countRows(t, "puzzleReviews")).toBe(0);
  });
});
