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

// Seed a review ROW directly into `puzzleReviews` (bypassing the mutation) so list coverage can
// pin rows the form can't produce today: migrated text-only rows (rating undefined), backdated
// updatedAt values, other members' rows.
const seedReview = (
  t: ReturnType<typeof convexTest>,
  args: {
    puzzleId: Id<"puzzles">;
    userId: Id<"users">;
    text?: string;
    rating?: number;
    updatedAt?: number;
  },
) =>
  t.run(async (ctx) => {
    const at = args.updatedAt ?? Date.now();
    await ctx.db.insert("puzzleReviews", {
      puzzleId: args.puzzleId,
      userId: args.userId,
      text: args.text,
      rating: args.rating,
      createdAt: at,
      updatedAt: at,
    });
  });

// One review per (member, puzzle) — multi-review scenarios need extra members.
const mkMember = (
  t: ReturnType<typeof convexTest>,
  clerkId: string,
  name: string,
) =>
  t.run(async (ctx) => {
    const now = Date.now();
    return ctx.db.insert("users", {
      clerkId,
      email: `${clerkId}@example.com`,
      name,
      isActive: true,
      createdAt: now,
      updatedAt: now,
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

// The list reads the member's `puzzleReviews` rows; extra rows are seeded directly so migrated
// text-only shapes and backdated updatedAt values can be pinned.
describe("listPuzzleReviews — sourced from puzzleReviews", () => {
  test("returns a seeded review with the real author", async () => {
    const t = convexTest(schema, modules);
    const { alice, puzzleId } = await seed(t);

    await seedReview(t, {
      puzzleId,
      userId: alice,
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

  test("a migrated text-only row serializes rating null", async () => {
    const t = convexTest(schema, modules);
    const { alice, puzzleId } = await seed(t);

    await seedReview(t, {
      puzzleId,
      userId: alice,
      text: "No stars from me",
    });

    const list = await asAlice(t).query(
      api.social.listPuzzleReviews.listPuzzleReviews,
      { puzzleId },
    );
    expect(list).toHaveLength(1);
    expect(list[0].rating).toBeNull();
    expect(list[0].text).toBe("No stars from me");
  });

  test("a rating-only row serializes text null", async () => {
    const t = convexTest(schema, modules);
    const { alice, puzzleId } = await seed(t);

    await seedReview(t, { puzzleId, userId: alice, rating: 4 });

    const list = await asAlice(t).query(
      api.social.listPuzzleReviews.listPuzzleReviews,
      { puzzleId },
    );
    expect(list).toHaveLength(1);
    expect(list[0].rating).toBe(4);
    expect(list[0].text).toBeNull();
  });

  test("reviews order desc by updatedAt, not by insertion order", async () => {
    const t = convexTest(schema, modules);
    const { alice, puzzleId } = await seed(t);
    const bob = await mkMember(t, "clerk_bob", "Bob");
    const cara = await mkMember(t, "clerk_cara", "Cara");
    const base = Date.now();

    // Insertion order alice, bob, cara — updatedAt says cara, alice, bob. The by_puzzle index
    // orders by _creationTime, so a creation-time read would return the wrong order.
    await seedReview(t, {
      puzzleId,
      userId: alice,
      text: "middle",
      updatedAt: base + 2_000,
    });
    await seedReview(t, {
      puzzleId,
      userId: bob,
      text: "oldest",
      updatedAt: base + 1_000,
    });
    await seedReview(t, {
      puzzleId,
      userId: cara,
      text: "newest",
      updatedAt: base + 3_000,
    });

    const list = await asAlice(t).query(
      api.social.listPuzzleReviews.listPuzzleReviews,
      { puzzleId },
    );
    expect(list.map((c) => c.text)).toEqual(["newest", "middle", "oldest"]);
    // updatedAt is surfaced as-is.
    expect(list.map((c) => c.updatedAt)).toEqual([
      base + 3_000,
      base + 2_000,
      base + 1_000,
    ]);
  });

  test("a vanished author falls back to a synthetic 'Member' view", async () => {
    const t = convexTest(schema, modules);
    const { puzzleId } = await seed(t);
    const bob = await mkMember(t, "clerk_bob", "Bob");

    await seedReview(t, { puzzleId, userId: bob, text: "Orphaned", rating: 3 });
    await t.run(async (ctx) => {
      await ctx.db.delete(bob);
    });

    const list = await asAlice(t).query(
      api.social.listPuzzleReviews.listPuzzleReviews,
      { puzzleId },
    );
    expect(list).toHaveLength(1);
    expect(list[0].text).toBe("Orphaned");
    expect(list[0].author._id).toBe(bob as string);
    expect(list[0].author.name).toBe("Member");
    expect(list[0].author.isActive).toBe(false);
  });

  test("end-to-end: postPuzzleReview then listPuzzleReviews shows the review", async () => {
    const t = convexTest(schema, modules);
    const { alice, puzzleId } = await seed(t);

    await asAlice(t).mutation(api.social.postPuzzleReview.postPuzzleReview, {
      puzzleId,
      rating: 5,
      text: "Stunning artwork",
    });

    const list = await asAlice(t).query(
      api.social.listPuzzleReviews.listPuzzleReviews,
      { puzzleId },
    );
    expect(list).toHaveLength(1);
    expect(list[0].rating).toBe(5);
    expect(list[0].text).toBe("Stunning artwork");
    expect(list[0].author._id).toBe(alice as string);
    expect(list[0].author.name).toBe("Alice");
  });

  // SECURITY: listPuzzleReviews projects each author through `toMemberView`, exposing member
  // identity (name/username/bio/location) meant only for OTHER AUTHENTICATED MEMBERS. An
  // unauthenticated caller must be rejected so that PII never leaks to anonymous clients.
  test("auth is required to list reviews (no anonymous PII exposure)", async () => {
    const t = convexTest(schema, modules);
    const { alice, puzzleId } = await seed(t);

    await seedReview(t, {
      puzzleId,
      userId: alice,
      text: "Stunning artwork",
      rating: 5,
    });

    await expect(
      t.query(api.social.listPuzzleReviews.listPuzzleReviews, { puzzleId }),
    ).rejects.toThrow(ConvexError);
  });
});
