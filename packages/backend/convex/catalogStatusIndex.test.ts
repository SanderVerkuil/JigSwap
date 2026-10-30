import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// PERF-B8: every catalog list reads puzzles by status through the by_status / by_status_brand
// indexes instead of scanning the table. These tests pin the behaviour that must survive that
// switch: only approved rows reach public lists, the pending queue lists only pending rows, and
// each list keeps the order it had (newest-first where it was newest-first).

const NOW = 1_000_000;

type Status = "pending" | "approved" | "rejected" | "disabled";

// Statuses interleaved in creation order, so a leaked status or a lost order shows up.
const ROWS: {
  slug: string;
  status: Status;
  brand: string;
  pieceCount: number;
}[] = [
  { slug: "a1", status: "approved", brand: "Ravensburger", pieceCount: 1000 },
  { slug: "p1", status: "pending", brand: "Ravensburger", pieceCount: 1000 },
  { slug: "a2", status: "approved", brand: "Jumbo", pieceCount: 500 },
  { slug: "r1", status: "rejected", brand: "Jumbo", pieceCount: 500 },
  { slug: "a3", status: "approved", brand: "Ravensburger", pieceCount: 500 },
  { slug: "d1", status: "disabled", brand: "Ravensburger", pieceCount: 1000 },
  { slug: "p2", status: "pending", brand: "Jumbo", pieceCount: 1000 },
  { slug: "a4", status: "approved", brand: "Jumbo", pieceCount: 1000 },
  { slug: "a5", status: "approved", brand: "Ravensburger", pieceCount: 1000 },
];

const title = (slug: string) => `Puzzle ${slug}`;
const titlesWhere = (pick: (row: (typeof ROWS)[number]) => boolean) =>
  ROWS.filter(pick).map((r) => title(r.slug));

const APPROVED_OLDEST_FIRST = titlesWhere((r) => r.status === "approved");
const APPROVED_NEWEST_FIRST = [...APPROVED_OLDEST_FIRST].reverse();

const mkMember = (t: TestConvex<typeof schema>, clerkId: string) =>
  t.run((ctx) =>
    ctx.db.insert("users", {
      clerkId,
      email: `${clerkId}@example.com`,
      name: clerkId,
      isActive: true,
      createdAt: NOW,
      updatedAt: NOW,
    }),
  );

const seed = async (t: TestConvex<typeof schema>) => {
  const alice = await mkMember(t, "clerk_alice");
  const ids = await t.run(async (ctx) => {
    const out: Record<string, Id<"puzzles">> = {};
    for (const [i, row] of ROWS.entries()) {
      out[row.slug] = await ctx.db.insert("puzzles", {
        aggregateId: `def-${row.slug}`,
        title: title(row.slug),
        brand: row.brand,
        pieceCount: row.pieceCount,
        searchableText: `puzzle ${row.slug} ${row.brand.toLowerCase()}`,
        status: row.status,
        submittedBy: alice,
        createdAt: NOW + i,
        updatedAt: NOW + 100 + i,
      });
    }
    return out;
  });
  return { alice, ids };
};

const asAlice = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_alice" });
const asAdmin = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_alice", metadata: { role: "admin" } });

type Page<T> = { page: T[]; isDone: boolean; continueCursor: string };

// Walk every page of a paginated query and return the rows in order, plus the page count.
const walk = async <T>(
  fetchPage: (cursor: string | null) => Promise<Page<T>>,
): Promise<{ rows: T[]; pages: number }> => {
  const rows: T[] = [];
  let cursor: string | null = null;
  let pages = 0;
  for (;;) {
    const result = await fetchPage(cursor);
    rows.push(...result.page);
    pages += 1;
    if (result.isDone) return { rows, pages };
    cursor = result.continueCursor;
  }
};

describe("catalog reads by status (PERF-B8)", () => {
  test("getRecentPuzzles lists approved rows only, newest first", async () => {
    const t = convexTest(schema, modules);
    await seed(t);

    const recent = await t.query(
      api.catalog.getRecentPuzzles.getRecentPuzzles,
      { limit: 3 },
    );
    expect(recent.map((p) => p.title)).toEqual(
      APPROVED_NEWEST_FIRST.slice(0, 3),
    );
  });

  test("listAllPuzzles pages through approved rows only, oldest first as before", async () => {
    const t = convexTest(schema, modules);
    await seed(t);

    const { rows, pages } = await walk((cursor) =>
      t.query(api.catalog.listAllPuzzles.listAllPuzzles, {
        paginationOpts: { numItems: 2, cursor },
      }),
    );
    expect(pages).toBeGreaterThan(1);
    expect(rows.map((p) => p.title)).toEqual(APPROVED_OLDEST_FIRST);
  });

  test("searchCatalog's empty-term browse pages through approved rows only, oldest first as before", async () => {
    const t = convexTest(schema, modules);
    await seed(t);

    const { rows } = await walk((cursor) =>
      asAlice(t).query(api.catalog.searchCatalog.searchCatalog, {
        paginationOpts: { numItems: 2, cursor },
      }),
    );
    expect(rows.map((p) => p.title)).toEqual(APPROVED_OLDEST_FIRST);
  });

  test("browsePublicCatalog lists approved rows only, newest first, across pages", async () => {
    const t = convexTest(schema, modules);
    await seed(t);

    const { rows, pages } = await walk((cursor) =>
      t.query(api.catalog.browsePublicCatalog.browsePublicCatalog, {
        paginationOpts: { numItems: 2, cursor },
      }),
    );
    expect(pages).toBeGreaterThan(1);
    expect(rows.map((p) => p.title)).toEqual(APPROVED_NEWEST_FIRST);
  });

  test("browsePublicCatalog's brand filter returns that brand's approved rows only, newest first", async () => {
    const t = convexTest(schema, modules);
    await seed(t);

    const { rows } = await walk((cursor) =>
      t.query(api.catalog.browsePublicCatalog.browsePublicCatalog, {
        paginationOpts: { numItems: 1, cursor },
        brand: "Ravensburger",
      }),
    );
    expect(rows.map((p) => p.title)).toEqual(
      titlesWhere(
        (r) => r.status === "approved" && r.brand === "Ravensburger",
      ).reverse(),
    );

    // Brand and piece range together: the range narrows within the brand.
    const jumboLarge = await t.query(
      api.catalog.browsePublicCatalog.browsePublicCatalog,
      {
        paginationOpts: { numItems: 20, cursor: null },
        brand: "Jumbo",
        pieceMin: 1000,
      },
    );
    expect(jumboLarge.page.map((p) => p.title)).toEqual([title("a4")]);

    // A brand with no approved rows (only a rejected one would match otherwise) is empty.
    const none = await t.query(
      api.catalog.browsePublicCatalog.browsePublicCatalog,
      { paginationOpts: { numItems: 20, cursor: null }, brand: "Clementoni" },
    );
    expect(none.page).toEqual([]);
  });

  test("the moderation queue lists pending rows only, newest first, for admins only", async () => {
    const t = convexTest(schema, modules);
    await seed(t);

    const queue = await asAdmin(t).query(
      api.catalog.listPendingPuzzleDefinitions.listPendingPuzzleDefinitions,
      {},
    );
    expect(queue.map((p) => p.title)).toEqual(
      titlesWhere((r) => r.status === "pending").reverse(),
    );

    await expect(
      asAlice(t).query(
        api.catalog.listPendingPuzzleDefinitions.listPendingPuzzleDefinitions,
        {},
      ),
    ).rejects.toThrow(/Forbidden/);
  });

  test("the landing plank and recommendations draw from approved rows only", async () => {
    const t = convexTest(schema, modules);
    await seed(t);

    const plank = await t.query(api.insights.getPlankPuzzles.getPlankPuzzles, {
      limit: 12,
      seed: 7,
    });
    expect(plank.map((p) => p.title).sort()).toEqual(
      [...APPROVED_OLDEST_FIRST].sort(),
    );

    // With no taste signals every approved candidate is ranked (the card shows up to 12).
    const recs = await asAlice(t).query(
      api.insights.getRecommendations.getRecommendations,
      {},
    );
    expect(recs.map((r) => r.title).sort()).toEqual(
      [...APPROVED_OLDEST_FIRST].sort(),
    );
  });
});
