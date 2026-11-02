import { puzzleSearchableText } from "@jigswap/domain";
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Search ignores accents on both sides: "cafe" finds "Café" and "Café" finds "Cafe", on every
// catalogue search and on Browse. A row written before searchableText was folded keeps its accents
// until the backfill reaches it, and stays findable by its accented spelling until then.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const NOW = 1_700_000_000_000;

const seed = (t: TestConvex<typeof schema>) =>
  t.run(async (ctx) => {
    const mkUser = (clerkId: string) =>
      ctx.db.insert("users", {
        clerkId,
        email: `${clerkId}@example.com`,
        name: clerkId,
        isActive: true,
        createdAt: NOW,
        updatedAt: NOW,
      });
    const alice = await mkUser("clerk_alice");
    const bob = await mkUser("clerk_bob");
    const base = {
      pieceCount: 1000,
      submittedBy: bob,
      status: "approved" as const,
      createdAt: NOW,
      updatedAt: NOW,
    };
    const folded = await ctx.db.insert("puzzles", {
      ...base,
      title: "Café Zuid",
      searchableText: puzzleSearchableText({ title: "Café Zuid" }),
    });
    const plain = await ctx.db.insert("puzzles", {
      ...base,
      title: "Cafe Noord",
      searchableText: puzzleSearchableText({ title: "Cafe Noord" }),
    });
    // As stored before the fold: the accents are still in the index.
    const legacy = await ctx.db.insert("puzzles", {
      ...base,
      title: "Crème Brûlée",
      brand: "Château",
      tags: ["été"],
      searchableText: "Crème Brûlée Château été",
    });
    await ctx.db.insert("ownedPuzzles", {
      puzzleId: folded,
      ownerId: bob,
      condition: "good",
      availability: { forTrade: true, forSale: false, forLend: false },
      createdAt: NOW,
      updatedAt: NOW,
    });
    return { alice, bob, folded, plain, legacy };
  });

const asAlice = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_alice" });

const search = async (t: TestConvex<typeof schema>, searchTerm: string) => {
  const { page } = await asAlice(t).query(
    api.catalog.searchCatalog.searchCatalog,
    {
      searchTerm,
      paginationOpts: { numItems: 10, cursor: null },
    },
  );
  return page.map((row) => row.title).sort();
};

describe("catalogue search ignores accents", () => {
  test("an unaccented term finds the accented title, and the other way round", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    expect(await search(t, "cafe")).toEqual(["Cafe Noord", "Café Zuid"]);
    expect(await search(t, "Café")).toEqual(["Cafe Noord", "Café Zuid"]);
  });

  test("a row not yet backfilled stays findable by its accented spelling", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    expect(await search(t, "crème")).toEqual(["Crème Brûlée"]);
  });

  test("the contribute form's suggestions, the public catalogue and the palette fold too", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const suggestions = await asAlice(t).query(
      api.catalog.getPuzzleSuggestions.getPuzzleSuggestions,
      { searchTerm: "café" },
    );
    expect(suggestions.map((row) => row.title).sort()).toEqual([
      "Cafe Noord",
      "Café Zuid",
    ]);

    const publicPage = await t.query(
      api.catalog.browsePublicCatalog.browsePublicCatalog,
      { searchTerm: "café", paginationOpts: { numItems: 10, cursor: null } },
    );
    expect(publicPage.page.map((row) => row.title).sort()).toEqual([
      "Cafe Noord",
      "Café Zuid",
    ]);

    const palette = await asAlice(t).query(api.search.globalSearch.global, {
      term: "café",
    });
    expect(palette.puzzles.map((row) => row.title).sort()).toEqual([
      "Cafe Noord",
      "Café Zuid",
    ]);
  });
});

describe("Browse search ignores accents", () => {
  const browse = (t: TestConvex<typeof schema>, searchTerm: string) =>
    asAlice(t).query(api.library.browseOwnedPuzzles.browseOwnedPuzzles, {
      searchTerm,
    });

  test.each(["cafe", "CAFE", "Café"])(
    "%s finds the copy of Café Zuid",
    async (term) => {
      const t = convexTest(schema, modules);
      await seed(t);
      const { ownedPuzzles } = await browse(t, term);
      expect(ownedPuzzles.map((copy) => copy.puzzle?.title)).toEqual([
        "Café Zuid",
      ]);
    },
  );
});

describe("catalog.backfillSearchableText", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const backfill =
    internal.catalog.backfillSearchableText.backfillSearchableText;
  const runAll = async (
    t: TestConvex<typeof schema>,
    args: { dryRun?: boolean } = {},
  ) => {
    vi.useFakeTimers();
    try {
      const first = await t.mutation(backfill, args);
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      return first;
    } finally {
      vi.useRealTimers();
    }
  };
  const textOf = (t: TestConvex<typeof schema>, id: Id<"puzzles">) =>
    t.run(async (ctx) => (await ctx.db.get(id))?.searchableText);

  test("a dry run counts and writes nothing", async () => {
    const t = convexTest(schema, modules);
    const { legacy } = await seed(t);
    expect(await runAll(t, { dryRun: true })).toEqual({
      scanned: 3,
      patched: 1,
    });
    expect(await textOf(t, legacy)).toBe("Crème Brûlée Château été");
  });

  test("folds a stale row without touching updatedAt, and a second run changes nothing", async () => {
    const t = convexTest(schema, modules);
    const { legacy } = await seed(t);
    expect(await runAll(t)).toEqual({ scanned: 3, patched: 1 });
    expect(await textOf(t, legacy)).toBe("Creme Brulee Chateau ete");
    expect(await search(t, "creme")).toEqual(["Crème Brûlée"]);
    expect(await search(t, "crème")).toEqual(["Crème Brûlée"]);
    const row = await t.run((ctx) => ctx.db.get(legacy));
    expect(row?.updatedAt).toBe(NOW);
    expect(await runAll(t)).toEqual({ scanned: 3, patched: 0 });
  });

  test("walks every page", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    await t.run(async (ctx) => {
      for (let i = 0; i < 120; i += 1) {
        await ctx.db.insert("puzzles", {
          title: `Été ${i}`,
          pieceCount: 500,
          status: "approved",
          submittedBy: bob,
          createdAt: NOW,
          updatedAt: NOW,
          searchableText: `Été ${i}`,
        });
      }
    });
    await runAll(t);
    const stale = await t.run(async (ctx) =>
      (await ctx.db.query("puzzles").collect()).filter((row) =>
        row.searchableText?.includes("É"),
      ),
    );
    expect(stale).toEqual([]);
  });
});
