import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { SEARCH_CATALOG_ROWS_READ } from "./catalog/searchCatalog";
import schema from "./schema";

// The member catalogue's plain browse filters as it reads, and a page that can't fill would otherwise
// read to the end of the approved catalogue in one call, however few rows it asks for. So one call
// reads a bounded number of rows and answers with the cursor where it stopped: a short page, even an
// empty one, that isn't done. Brand and piece filters read only the rows they can match.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);
type T = TestConvex<typeof schema>;
const NOW = 1_700_000_000_000;

const seedMember = (t: T) =>
  t.run((ctx) =>
    ctx.db.insert("users", {
      clerkId: "clerk_me",
      email: "me@example.com",
      name: "me",
      isActive: true,
      createdAt: NOW,
      updatedAt: NOW,
    }),
  );

type Facts = {
  brand?: string;
  pieceCount?: number;
  difficulty?: "easy" | "medium" | "hard" | "expert";
};

const addDefinitions = async (
  t: T,
  submittedBy: Id<"users">,
  count: number,
  factsOf: (i: number) => Facts = () => ({}),
) => {
  for (let start = 0; start < count; start += 300) {
    await t.run(async (ctx) => {
      for (let i = start; i < Math.min(count, start + 300); i++) {
        await ctx.db.insert("puzzles", {
          title: `p${i}`,
          pieceCount: 1000,
          status: "approved",
          submittedBy,
          createdAt: NOW,
          updatedAt: NOW,
          ...factsOf(i),
        });
      }
    });
  }
};

type Args = Facts & { pieceMin?: number; pieceMax?: number; tags?: string[] };

const search = (
  t: T,
  args: Args,
  paginationOpts: {
    numItems: number;
    cursor: string | null;
    maximumRowsRead?: number;
  },
) =>
  t
    .withIdentity({ subject: "clerk_me" })
    .query(api.catalog.searchCatalog.searchCatalog, {
      ...args,
      paginationOpts,
    });

// A facet nothing has, on a catalogue past the bound.
const OVER = SEARCH_CATALOG_ROWS_READ * 2 + 50;

describe("catalog.search: one call's read is bounded", () => {
  test("a facet that matches nothing stops at the bound and says it isn't done", async () => {
    const t = convexTest({ schema, modules, transactionLimits: true });
    await addDefinitions(t, await seedMember(t), OVER);

    const first = await search(
      t,
      { difficulty: "expert" },
      { numItems: 1, cursor: null },
    );

    expect(first.page).toEqual([]);
    expect(first.isDone).toBe(false);
  }, 120_000);

  test("a client can't raise the bound", async () => {
    const t = convexTest(schema, modules);
    await addDefinitions(t, await seedMember(t), OVER);

    const first = await search(
      t,
      { difficulty: "expert" },
      { numItems: 1, cursor: null, maximumRowsRead: 1e9 },
    );

    expect(first.isDone).toBe(false);
  }, 120_000);

  test("walking the cursor reaches every match once, in the order the catalogue reads", async () => {
    const t = convexTest(schema, modules);
    await addDefinitions(t, await seedMember(t), OVER, (i) => ({
      difficulty: i % 100 === 0 ? "hard" : "easy",
    }));
    const expected = Array.from({ length: OVER }, (_, i) => i)
      .filter((i) => i % 100 === 0)
      .map((i) => `p${i}`);

    const seen: string[] = [];
    let cursor: string | null = null;
    let calls = 0;
    for (;;) {
      const page: Awaited<ReturnType<typeof search>> = await search(
        t,
        { difficulty: "hard" },
        { numItems: 20, cursor },
      );
      seen.push(...page.page.map((row) => row.title));
      calls += 1;
      if (page.isDone) break;
      cursor = page.continueCursor;
    }

    expect(seen).toEqual(expected);
    expect(calls).toBeGreaterThan(1);
  }, 120_000);

  test("a page with plenty of matches fills up, however many facets are set", async () => {
    const t = convexTest(schema, modules);
    await addDefinitions(t, await seedMember(t), 60, () => ({
      difficulty: "easy",
    }));

    const page = await search(
      t,
      { difficulty: "easy" },
      { numItems: 20, cursor: null },
    );

    expect(page.page).toHaveLength(20);
    expect(page.isDone).toBe(false);
  });
});

describe("catalog.search: brand and piece filters read their own rows", () => {
  // Past the bound of other rows, so these only finish in one call by not reading them.
  const seedRare = async (t: T) => {
    await addDefinitions(t, await seedMember(t), OVER, (i) =>
      i % 100 === 7 ? { brand: "Rare", pieceCount: 42 } : { brand: "Common" },
    );
  };

  test("a brand", async () => {
    const t = convexTest({ schema, modules, transactionLimits: true });
    await seedRare(t);

    const page = await search(
      t,
      { brand: "Rare", difficulty: "expert" },
      { numItems: 1, cursor: null },
    );

    expect(page.page).toEqual([]);
    expect(page.isDone).toBe(true);
  }, 120_000);

  test("a piece range, smallest first", async () => {
    const t = convexTest({ schema, modules, transactionLimits: true });
    await addDefinitions(t, await seedMember(t), OVER, (i) => ({
      pieceCount: i % 100 === 7 ? 40 + (OVER - i) : 1000,
    }));

    const page = await search(
      t,
      { pieceMax: 999 },
      { numItems: 50, cursor: null },
    );

    expect(page.isDone).toBe(true);
    const counts = page.page.map((row) => row.pieceCount);
    expect(counts.length).toBeGreaterThan(0);
    expect(counts).toEqual([...counts].sort((a, b) => a - b));
  }, 120_000);

  test("a piece range that can't hold anything, a brand and a range together", async () => {
    const t = convexTest(schema, modules);
    await seedRare(t);

    expect(
      await search(
        t,
        { pieceMin: 500, pieceMax: 100 },
        { numItems: 5, cursor: null },
      ),
    ).toMatchObject({ page: [], isDone: true });
    const both = await search(
      t,
      { brand: "Rare", pieceMin: 40, pieceMax: 50 },
      { numItems: 50, cursor: null },
    );
    expect(both.isDone).toBe(true);
    expect(both.page.length).toBeGreaterThan(0);
    expect(both.page.every((row) => row.pieceCount === 42)).toBe(true);
  }, 120_000);

  test("only approved rows come through either index", async () => {
    const t = convexTest(schema, modules);
    const me = await seedMember(t);
    await addDefinitions(t, me, 2, () => ({ brand: "B", pieceCount: 10 }));
    await t.run((ctx) =>
      ctx.db.insert("puzzles", {
        title: "pending",
        brand: "B",
        pieceCount: 10,
        status: "pending",
        submittedBy: me,
        createdAt: NOW,
        updatedAt: NOW,
      }),
    );
    for (const args of [{ brand: "B" }, { pieceMax: 10 }]) {
      const { page } = await search(t, args, { numItems: 10, cursor: null });
      expect(page.map((row) => row.title)).toEqual(["p0", "p1"]);
    }
  });
});
