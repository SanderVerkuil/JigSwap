import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob("./**/!(*.test).*s");

// Seed one approved + one pending definition so the public-list filtering is exercised, plus a
// distinct brand/tag set for the filter reads.
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

    const category = await ctx.db.insert("adminCategories", {
      name: { en: "Landscapes", nl: "Landschappen" },
      isActive: true,
      sortOrder: 0,
      createdAt: now,
      updatedAt: now,
    });
    // Inactive category must NOT surface in getPuzzleCategories.
    await ctx.db.insert("adminCategories", {
      name: { en: "Hidden", nl: "Verborgen" },
      isActive: false,
      sortOrder: 1,
      createdAt: now,
      updatedAt: now,
    });

    const approved = await ctx.db.insert("puzzles", {
      aggregateId: "def-approved",
      title: "Mountain Vista",
      brand: "Ravensburger",
      pieceCount: 1000,
      difficulty: "hard",
      category,
      tags: ["nature", "mountains"],
      searchableText: "mountain vista ravensburger",
      status: "approved",
      submittedBy: alice,
      createdAt: now,
      updatedAt: now,
    });
    // Pending: excluded from public lists/suggestions.
    await ctx.db.insert("puzzles", {
      aggregateId: "def-pending",
      title: "Secret Ocean",
      brand: "Clementoni",
      pieceCount: 500,
      tags: ["nature", "ocean"],
      searchableText: "secret ocean clementoni",
      status: "pending",
      submittedBy: alice,
      createdAt: now,
      updatedAt: now,
    });

    return { alice, category, approved };
  });

describe("catalog reads", () => {
  test("getPuzzleById returns a typed definition view or null", async () => {
    const t = convexTest(schema, modules);
    const { approved } = await seed(t);

    const view = await t.query(api.catalog.getPuzzleById.getPuzzleById, {
      puzzleId: approved,
    });
    expect(view).not.toBeNull();
    expect(view?.title).toBe("Mountain Vista");
    expect(view?.aggregateId).toBe("def-approved");
    expect(view?.status).toBe("approved");
    // Box-art unset -> resolved as null (DTO contract), not the raw storage id.
    expect(view?.image).toBeNull();
  });

  test("listAllPuzzles returns only approved definitions", async () => {
    const t = convexTest(schema, modules);
    await seed(t);

    const page = await t.query(api.catalog.listAllPuzzles.listAllPuzzles, {
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(page.page).toHaveLength(1);
    expect(page.page[0].title).toBe("Mountain Vista");
    expect(page.page[0].image).toBeNull();
  });

  test("getRecentPuzzles returns approved-only, newest-first, capped by limit", async () => {
    const t = convexTest(schema, modules);
    await seed(t);

    const recent = await t.query(
      api.catalog.getRecentPuzzles.getRecentPuzzles,
      { limit: 5 },
    );
    expect(recent.every((p) => p.status === "approved")).toBe(true);
    expect(recent.map((p) => p.title)).toEqual(["Mountain Vista"]);
  });

  test("getPuzzleSuggestions matches approved definitions and honours the empty-term guard", async () => {
    const t = convexTest(schema, modules);
    await seed(t);

    const hits = await t.query(
      api.catalog.getPuzzleSuggestions.getPuzzleSuggestions,
      { searchTerm: "mountain" },
    );
    expect(hits.map((p) => p.title)).toContain("Mountain Vista");

    const empty = await t.query(
      api.catalog.getPuzzleSuggestions.getPuzzleSuggestions,
      { searchTerm: "   " },
    );
    expect(empty).toEqual([]);
  });

  test("getPuzzleCategories returns active categories only", async () => {
    const t = convexTest(schema, modules);
    await seed(t);

    const categories = await t.query(
      api.catalog.getPuzzleCategories.getPuzzleCategories,
      {},
    );
    expect(categories.map((c) => c.name.en)).toEqual(["Landscapes"]);
  });

  test("getAllBrands returns the distinct brand set", async () => {
    const t = convexTest(schema, modules);
    await seed(t);

    const brands = await t.query(api.catalog.getAllBrands.getAllBrands, {});
    expect(new Set(brands)).toEqual(new Set(["Ravensburger", "Clementoni"]));
  });

  test("getAllTags returns the flattened, de-duplicated tag set", async () => {
    const t = convexTest(schema, modules);
    await seed(t);

    const tags = await t.query(api.catalog.getAllTags.getAllTags, {});
    expect(new Set(tags)).toEqual(new Set(["nature", "mountains", "ocean"]));
  });
});
