import { convexTest } from "convex-test";
import type { FunctionArgs } from "convex/server";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const APPROVED_LAKES = 30;

// Seed one member, many approved "lake" definitions (more than one page), a pending "lake"
// definition that must never surface, and barcoded definitions for the lookup.
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
    const base = {
      pieceCount: 1000,
      tags: [],
      submittedBy: alice,
      createdAt: now,
      updatedAt: now,
    };
    for (let i = 0; i < APPROVED_LAKES; i += 1) {
      await ctx.db.insert("puzzles", {
        ...base,
        aggregateId: `lake-${i}`,
        title: `Lake ${i}`,
        brand: "Ravensburger",
        searchableText: `lake ${i} ravensburger`,
        status: "approved",
      });
    }
    await ctx.db.insert("puzzles", {
      ...base,
      aggregateId: "lake-pending",
      title: "Pending Lake",
      searchableText: "pending lake",
      status: "pending",
    });
    await ctx.db.insert("puzzles", {
      ...base,
      aggregateId: "forest",
      title: "Forest",
      brand: "Jumbo",
      searchableText: "forest jumbo",
      status: "approved",
    });
    const withEan = await ctx.db.insert("puzzles", {
      ...base,
      aggregateId: "with-ean",
      title: "Barcoded Castle",
      brand: "Jumbo",
      searchableText: "barcoded castle jumbo",
      ean: "4006381333931",
      status: "approved",
    });
    const withUpc = await ctx.db.insert("puzzles", {
      ...base,
      aggregateId: "with-upc",
      title: "Barcoded Bridge",
      searchableText: "barcoded bridge",
      upc: "036000291452",
      status: "approved",
    });
    await ctx.db.insert("puzzles", {
      ...base,
      aggregateId: "pending-ean",
      title: "Pending Barcode",
      searchableText: "pending barcode",
      ean: "9780201379624",
      status: "pending",
    });
    return { alice, withEan, withUpc };
  });

const asAlice = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice" });

describe("add-flow catalogue search", () => {
  test("pages through every approved match beyond the first page, never a pending one", async () => {
    const t = convexTest(schema, modules);
    await seed(t);

    const titles: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    for (;;) {
      const result: {
        page: { title: string }[];
        isDone: boolean;
        continueCursor: string;
      } = await asAlice(t).query(api.catalog.searchCatalog.searchCatalog, {
        searchTerm: "lake",
        paginationOpts: { numItems: 10, cursor },
      });
      titles.push(...result.page.map((p) => p.title));
      pages += 1;
      if (result.isDone) break;
      cursor = result.continueCursor;
    }

    expect(pages).toBeGreaterThan(1);
    expect(titles).toHaveLength(APPROVED_LAKES);
    expect(new Set(titles).size).toBe(APPROVED_LAKES);
    expect(titles).toContain("Lake 29");
    expect(titles).not.toContain("Pending Lake");
    expect(titles).not.toContain("Forest");
  });

  test("an empty term browses the approved catalogue", async () => {
    const t = convexTest(schema, modules);
    await seed(t);

    const result = await asAlice(t).query(
      api.catalog.searchCatalog.searchCatalog,
      { searchTerm: "  ", paginationOpts: { numItems: 100, cursor: null } },
    );
    const titles = result.page.map((p) => p.title);
    expect(titles).toContain("Forest");
    expect(titles).not.toContain("Pending Lake");
    expect(titles).not.toContain("Pending Barcode");
  });

  test("search requires a signed-in member", async () => {
    const t = convexTest(schema, modules);
    await seed(t);

    await expect(
      t.query(api.catalog.searchCatalog.searchCatalog, {
        searchTerm: "lake",
        paginationOpts: { numItems: 10, cursor: null },
      }),
    ).rejects.toThrow(/Unauthenticated/);
  });
});

// Facet seed: interleaved "big" (Ravensburger, 2000 pieces, hard, Landscapes, water) and "small"
// (Jumbo, 500 pieces, easy, Animals, forest) lakes, so a facet has to skip rows inside every page,
// plus a pending row that matches every "big" facet and must never surface.
const PAIRS = 12;

const seedFacets = async (t: ReturnType<typeof convexTest>) =>
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
    const category = (en: string) =>
      ctx.db.insert("adminCategories", {
        name: { en, nl: en },
        isActive: true,
        sortOrder: 0,
        createdAt: now,
        updatedAt: now,
      });
    const landscapes = await category("Landscapes");
    const animals = await category("Animals");
    const base = {
      submittedBy: alice,
      createdAt: now,
      updatedAt: now,
      status: "approved" as const,
    };
    for (let i = 0; i < PAIRS; i += 1) {
      await ctx.db.insert("puzzles", {
        ...base,
        aggregateId: `big-${i}`,
        title: `Big Lake ${i}`,
        brand: "Ravensburger",
        pieceCount: 2000,
        difficulty: "hard",
        category: landscapes,
        tags: ["water", "nature"],
        searchableText: `big lake ${i} ravensburger`,
      });
      await ctx.db.insert("puzzles", {
        ...base,
        aggregateId: `small-${i}`,
        title: `Small Lake ${i}`,
        brand: "Jumbo",
        pieceCount: 500,
        difficulty: "easy",
        category: animals,
        tags: ["forest"],
        searchableText: `small lake ${i} jumbo`,
      });
    }
    await ctx.db.insert("puzzles", {
      ...base,
      status: "pending",
      aggregateId: "pending-big",
      title: "Pending Lake",
      brand: "Ravensburger",
      pieceCount: 2000,
      difficulty: "hard",
      category: landscapes,
      tags: ["water"],
      searchableText: "pending lake ravensburger",
    });
    return { landscapes, animals };
  });

type SearchArgs = FunctionArgs<typeof api.catalog.searchCatalog.searchCatalog>;
type FacetArgs = Omit<SearchArgs, "paginationOpts">;

// Pages through a search 5 rows at a time, so the matches span several pages, and returns every
// title it saw, sorted.
const searchAll = async (
  t: ReturnType<typeof convexTest>,
  args: FacetArgs,
): Promise<string[]> => {
  const titles: string[] = [];
  let cursor: string | null = null;
  for (;;) {
    const result: {
      page: { title: string }[];
      isDone: boolean;
      continueCursor: string;
    } = await asAlice(t).query(api.catalog.searchCatalog.searchCatalog, {
      ...args,
      paginationOpts: { numItems: 5, cursor },
    });
    titles.push(...result.page.map((p) => p.title));
    if (result.isDone) break;
    cursor = result.continueCursor;
  }
  return titles.sort();
};

const titlesOf = (prefix: "Big" | "Small") =>
  Array.from({ length: PAIRS }, (_, i) => `${prefix} Lake ${i}`).sort();

describe("catalogue search facets", () => {
  test.each([
    ["the plain browse", undefined],
    ["a term search", "lake"],
  ])(
    "each facet narrows %s, across pages, never to a pending row",
    async (_label, searchTerm) => {
      const t = convexTest(schema, modules);
      const { landscapes, animals } = await seedFacets(t);
      const big = titlesOf("Big");
      const small = titlesOf("Small");

      const cases: [FacetArgs, string[]][] = [
        [{ brand: "Ravensburger" }, big],
        [{ brand: "Jumbo" }, small],
        [{ pieceMin: 1000 }, big],
        [{ pieceMax: 1000 }, small],
        [{ pieceMin: 500, pieceMax: 500 }, small],
        [{ difficulty: "hard" }, big],
        [{ difficulty: "expert" }, []],
        [{ category: landscapes }, big],
        [{ category: animals }, small],
        [{ tags: ["water", "unknown"] }, big],
        [{ tags: ["water", "forest"] }, [...big, ...small].sort()],
        [{ brand: "Jumbo", pieceMax: 500, tags: ["forest"] }, small],
        [{ brand: "Jumbo", difficulty: "hard" }, []],
      ];
      for (const [facets, expected] of cases) {
        expect(
          await searchAll(t, { ...facets, searchTerm }),
          JSON.stringify(facets),
        ).toEqual(expected);
      }
    },
  );

  test("a term and facets combine", async () => {
    const t = convexTest(schema, modules);
    await seedFacets(t);

    expect(await searchAll(t, { searchTerm: "big", brand: "Jumbo" })).toEqual(
      [],
    );
    expect(await searchAll(t, { searchTerm: "small", pieceMax: 500 })).toEqual(
      titlesOf("Small"),
    );
  });

  test("a malformed category id gives an empty, finished page", async () => {
    const t = convexTest(schema, modules);
    await seedFacets(t);

    for (const searchTerm of [undefined, "lake"]) {
      const result = await asAlice(t).query(
        api.catalog.searchCatalog.searchCatalog,
        {
          searchTerm,
          category: "not-a-category",
          paginationOpts: { numItems: 5, cursor: null },
        },
      );
      expect(result.page).toEqual([]);
      expect(result.isDone).toBe(true);
    }
  });
});

describe("add-flow barcode lookup", () => {
  const lookup = (t: ReturnType<typeof convexTest>, code: string) =>
    asAlice(t).query(api.catalog.findPuzzleByBarcode.lookupPuzzleByBarcode, {
      code,
    });

  test("finds an approved puzzle by its EAN-13", async () => {
    const t = convexTest(schema, modules);
    const { withEan } = await seed(t);

    const match = await lookup(t, "4006381333931");
    expect(match?._id).toBe(withEan);
    expect(match?.title).toBe("Barcoded Castle");
  });

  test("finds an approved puzzle by its UPC-A, and a UPC stored as a 0-prefixed EAN", async () => {
    const t = convexTest(schema, modules);
    const { alice, withUpc } = await seed(t);

    expect((await lookup(t, "036000291452"))?._id).toBe(withUpc);

    // The same 12-digit code entered against a definition that stored it as an EAN-13.
    const asEan = await t.run(async (ctx) =>
      ctx.db.insert("puzzles", {
        aggregateId: "upc-as-ean",
        title: "Stored As Ean",
        pieceCount: 500,
        tags: [],
        searchableText: "stored as ean",
        ean: "0012345678905",
        status: "approved",
        submittedBy: alice,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    expect((await lookup(t, "012345678905"))?._id).toBe(asEan);
  });

  // The seed's "Pending Barcode" row is OLDER than this approved one and carries the same EAN;
  // a rejected row joins it. Neither may hide the approved puzzle from a scan.
  test("finds the approved puzzle even when older pending and rejected rows carry the same EAN", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);
    const approved = await t.run(async (ctx) => {
      const base = {
        pieceCount: 1000,
        tags: [],
        ean: "9780201379624",
        submittedBy: alice,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await ctx.db.insert("puzzles", {
        ...base,
        aggregateId: "rejected-ean",
        title: "Rejected Barcode",
        searchableText: "rejected barcode",
        status: "rejected",
      });
      return ctx.db.insert("puzzles", {
        ...base,
        aggregateId: "approved-ean",
        title: "Approved Barcode",
        searchableText: "approved barcode",
        status: "approved",
      });
    });

    const match = await lookup(t, "9780201379624");
    expect(match?._id).toBe(approved);
    expect(match?.title).toBe("Approved Barcode");
  });

  test("returns null when nothing matches, the match is pending, or the code is not barcode-shaped", async () => {
    const t = convexTest(schema, modules);
    await seed(t);

    expect(await lookup(t, "5012345678900")).toBeNull();
    expect(await lookup(t, "9780201379624")).toBeNull();
    expect(await lookup(t, "lake")).toBeNull();
    expect(await lookup(t, "12345")).toBeNull();

    // An 8-digit code is not looked up, even when a row carries it as its EAN.
    await t.run(async (ctx) => {
      const alice = await ctx.db
        .query("users")
        .withIndex("by_clerk_id", (q) => q.eq("clerkId", "clerk_alice"))
        .unique();
      await ctx.db.insert("puzzles", {
        aggregateId: "ean-8",
        title: "Eight Digits",
        pieceCount: 500,
        tags: [],
        searchableText: "eight digits",
        ean: "12345670",
        status: "approved",
        submittedBy: alice!._id,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
    expect(await lookup(t, "12345670")).toBeNull();
  });

  test("lookup requires a signed-in member", async () => {
    const t = convexTest(schema, modules);
    await seed(t);

    await expect(
      t.query(api.catalog.findPuzzleByBarcode.lookupPuzzleByBarcode, {
        code: "4006381333931",
      }),
    ).rejects.toThrow(/Unauthenticated/);
  });
});
