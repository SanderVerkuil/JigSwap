import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// Seed one member + ONE approved catalog puzzle. The catalog review FORM upserts the member's
// single `puzzleReviews` row keyed by the puzzle DEFINITION id directly (the catalog detail page
// has no copy id).
const seed = async (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const alice = await ctx.db.insert("users", {
      clerkId: "clerk_alice",
      email: "alice@example.com",
      name: "Alice",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const puzzleId = await ctx.db.insert("puzzles", {
      aggregateId: crypto.randomUUID(),
      title: "Mountain Vista",
      pieceCount: 1000,
      status: "approved",
      submittedBy: alice,
      createdAt: now,
      updatedAt: now,
    });
    return { alice, puzzleId };
  });

const asAlice = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice" });

// Seed a community review ROW directly into `puzzleComments`. The list side still reads
// `puzzleComments` until it is repointed at `puzzleReviews` in a later task, while the FORM
// already writes `puzzleReviews` — so list coverage pins current behavior by inserting rows
// itself instead of going through the mutation.
const seedComment = (
  t: ReturnType<typeof convexTest>,
  args: {
    puzzleId: Id<"puzzles">;
    authorId: Id<"users">;
    text: string;
    rating?: number;
  },
) =>
  t.run(async (ctx) => {
    await ctx.db.insert("puzzleComments", {
      aggregateId: crypto.randomUUID(),
      puzzleId: args.puzzleId,
      authorId: args.authorId,
      text: args.text,
      rating: args.rating,
      createdAt: Date.now(),
    });
  });

describe("postPuzzleReview — upserts the member's puzzleReviews row", () => {
  test("posting with a rating and no text stores one puzzleReviews row, zero puzzleComments", async () => {
    const t = convexTest(schema, modules);
    const { alice, puzzleId } = await seed(t);

    await asAlice(t).mutation(api.social.postPuzzleReview.postPuzzleReview, {
      puzzleId,
      rating: 4,
    });

    const reviews = await t.run((ctx) =>
      ctx.db.query("puzzleReviews").collect(),
    );
    expect(reviews).toHaveLength(1);
    expect(reviews[0].userId).toBe(alice);
    expect(reviews[0].puzzleId).toBe(puzzleId);
    expect(reviews[0].rating).toBe(4);
    expect(reviews[0].text).toBeUndefined();

    // The form no longer writes rated comments.
    const comments = await t.run((ctx) =>
      ctx.db.query("puzzleComments").collect(),
    );
    expect(comments).toHaveLength(0);
  });

  test("posting twice keeps ONE row: values updated, createdAt stable, updatedAt bumped", async () => {
    const t = convexTest(schema, modules);
    const { puzzleId } = await seed(t);

    await asAlice(t).mutation(api.social.postPuzzleReview.postPuzzleReview, {
      puzzleId,
      rating: 5,
      text: "Stunning artwork",
    });
    let rows = await t.run((ctx) => ctx.db.query("puzzleReviews").collect());
    expect(rows).toHaveLength(1);

    // Backdate the row so the second post's timestamps are distinguishable.
    const past = Date.now() - 60_000;
    await t.run(async (ctx) => {
      await ctx.db.patch(rows[0]._id, { createdAt: past, updatedAt: past });
    });

    await asAlice(t).mutation(api.social.postPuzzleReview.postPuzzleReview, {
      puzzleId,
      rating: 2,
      text: "Faded on second solve",
    });
    rows = await t.run((ctx) => ctx.db.query("puzzleReviews").collect());
    expect(rows).toHaveLength(1); // still ONE row — upsert, not insert
    expect(rows[0].rating).toBe(2);
    expect(rows[0].text).toBe("Faded on second solve");
    expect(rows[0].createdAt).toBe(past); // stable
    expect(rows[0].updatedAt).toBeGreaterThan(past); // bumped
  });

  test("whitespace-only text is normalised to undefined", async () => {
    const t = convexTest(schema, modules);
    const { puzzleId } = await seed(t);

    await asAlice(t).mutation(api.social.postPuzzleReview.postPuzzleReview, {
      puzzleId,
      rating: 3,
      text: "   ",
    });

    const rows = await t.run((ctx) => ctx.db.query("puzzleReviews").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].rating).toBe(3);
    expect(rows[0].text).toBeUndefined();
  });

  test("a rating out of range is rejected; nothing stored", async () => {
    const t = convexTest(schema, modules);
    const { puzzleId } = await seed(t);

    await expect(
      asAlice(t).mutation(api.social.postPuzzleReview.postPuzzleReview, {
        puzzleId,
        rating: 6,
        text: "ok",
      }),
    ).rejects.toThrow(ConvexError);

    const rows = await t.run((ctx) => ctx.db.query("puzzleReviews").collect());
    expect(rows).toHaveLength(0);
  });

  test("auth is required to post a review", async () => {
    const t = convexTest(schema, modules);
    const { puzzleId } = await seed(t);

    await expect(
      t.mutation(api.social.postPuzzleReview.postPuzzleReview, {
        puzzleId,
        rating: 4,
      }),
    ).rejects.toThrow(ConvexError);
  });
});

// The list still reads `puzzleComments` until a later task repoints it at `puzzleReviews`;
// rows are seeded directly (the form no longer writes comments) to pin current behavior.
describe("listPuzzleReviews — still comment-sourced (interim)", () => {
  test("returns a seeded comment with the real author", async () => {
    const t = convexTest(schema, modules);
    const { alice, puzzleId } = await seed(t);

    await seedComment(t, {
      puzzleId,
      authorId: alice,
      text: "Stunning artwork",
      rating: 5,
    });

    const list = await asAlice(t).query(
      api.social.listPuzzleReviews.listPuzzleReviews,
      { puzzleId },
    );
    expect(list).toHaveLength(1);
    expect(list[0].text).toBe("Stunning artwork");
    expect(list[0].rating).toBe(5);
    // Real author identity — never anonymised.
    expect(list[0].author._id).toBe(alice as string);
    expect(list[0].author.name).toBe("Alice");
  });

  test("a comment without a rating surfaces rating null", async () => {
    const t = convexTest(schema, modules);
    const { alice, puzzleId } = await seed(t);

    await seedComment(t, {
      puzzleId,
      authorId: alice,
      text: "No stars from me",
    });

    const list = await asAlice(t).query(
      api.social.listPuzzleReviews.listPuzzleReviews,
      { puzzleId },
    );
    expect(list).toHaveLength(1);
    expect(list[0].rating).toBeNull();
  });

  test("reviews are returned newest-first", async () => {
    const t = convexTest(schema, modules);
    const { alice, puzzleId } = await seed(t);

    await seedComment(t, { puzzleId, authorId: alice, text: "first" });
    await seedComment(t, { puzzleId, authorId: alice, text: "second" });

    const list = await asAlice(t).query(
      api.social.listPuzzleReviews.listPuzzleReviews,
      { puzzleId },
    );
    expect(list.map((c) => c.text)).toEqual(["second", "first"]);
  });

  // SECURITY: listPuzzleReviews projects each author through `toMemberView`, exposing member
  // identity (name/username/bio/location) meant only for OTHER AUTHENTICATED MEMBERS. An
  // unauthenticated caller must be rejected so that PII never leaks to anonymous clients.
  test("auth is required to list reviews (no anonymous PII exposure)", async () => {
    const t = convexTest(schema, modules);
    const { alice, puzzleId } = await seed(t);

    await seedComment(t, {
      puzzleId,
      authorId: alice,
      text: "Stunning artwork",
      rating: 5,
    });

    await expect(
      t.query(api.social.listPuzzleReviews.listPuzzleReviews, { puzzleId }),
    ).rejects.toThrow(ConvexError);
  });
});
