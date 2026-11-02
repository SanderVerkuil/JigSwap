import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const OPEN = { forTrade: true, forSale: false, forLend: false };
const CLOSED = { forTrade: false, forSale: false, forLend: false };

const asViewer = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_viewer" });

// Seed the viewer plus three other members (public / private / private-in-circle), a shared puzzle
// definition, and a copy for each member. Circle membership and a circle-copy-share are wired
// exactly as `collectCircleSharedCopies` reads them: `circleMembers.by_member` for the viewer's
// circles, `circleCopyShares.by_circle` keyed on the circle aggregateId, and copy resolution via
// `ownedPuzzles.by_aggregate_id`.
const seed = async (t: TestConvex<typeof schema>) =>
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

    const viewer = await mkUser("clerk_viewer", "Viewer");
    const publicOwner = await mkUser("clerk_public", "Pubby");
    const privateOwner = await mkUser("clerk_private", "Priv");
    const circleOwner = await mkUser("clerk_circle", "Circ");

    // Profile visibility: publicOwner defaults to public (no row), the other two are explicit.
    await ctx.db.insert("profiles", {
      memberId: privateOwner,
      displayName: "Priv",
      visibility: "private",
      updatedAt: now,
    });
    await ctx.db.insert("profiles", {
      memberId: circleOwner,
      displayName: "Circ",
      visibility: "private",
      updatedAt: now,
    });

    const puzzle = await ctx.db.insert("puzzles", {
      aggregateId: "def-1",
      title: "Mountain Vista",
      brand: "Ravensburger",
      pieceCount: 1000,
      status: "approved",
      submittedBy: viewer,
      createdAt: now,
      updatedAt: now,
    });

    const mkCopy = (
      aggregateId: string,
      ownerId: Id<"users">,
      availability: { forTrade: boolean; forSale: boolean; forLend: boolean },
    ) =>
      ctx.db.insert("ownedPuzzles", {
        aggregateId,
        puzzleId: puzzle,
        ownerId,
        condition: "good",
        availability,
        createdAt: now,
        updatedAt: now,
      });

    // Viewer's own OPEN copy (excluded from Browse by default).
    await mkCopy("copy-own", viewer, OPEN);
    // Public owner: OPEN (shown) and CLOSED (excluded — not open).
    await mkCopy("copy-public-open", publicOwner, OPEN);
    await mkCopy("copy-public-closed", publicOwner, CLOSED);
    // Private owner, no circle: OPEN copy is HIDDEN (private, unreachable).
    await mkCopy("copy-private-hidden", privateOwner, OPEN);
    // Private owner in a shared circle: OPEN copy is SHOWN via the circle path.
    await mkCopy("copy-circle-open", circleOwner, OPEN);

    // Circle wiring: viewer and circleOwner both belong to "circle-1"; the OPEN circle copy is
    // shared into it (keyed by the copy's aggregateId, per the read helper).
    const circleAggregateId = "circle-1";
    await ctx.db.insert("circles", {
      aggregateId: circleAggregateId,
      ownerId: circleOwner,
      name: "Saturday Puzzlers",
      memberships: [
        {
          id: "m-owner",
          memberId: circleOwner,
          permission: "Admin",
          joinedAt: now,
        },
        {
          id: "m-viewer",
          memberId: viewer,
          permission: "ViewOnly",
          joinedAt: now,
        },
      ],
      createdAt: now,
    });
    for (const memberId of [circleOwner, viewer]) {
      await ctx.db.insert("circleMembers", {
        circleAggregateId,
        memberId,
      });
    }
    await ctx.db.insert("circleCopyShares", {
      circleId: circleAggregateId,
      copyId: "copy-circle-open",
      sharedAt: now,
    });

    return { viewer, puzzle };
  });

const browse = async (
  t: TestConvex<typeof schema>,
  args: Record<string, unknown> = {},
) => asViewer(t).query(api.library.browseOwnedPuzzles.browseOwnedPuzzles, args);

const ids = (view: { ownedPuzzles: { aggregateId?: string }[] }) =>
  new Set(view.ownedPuzzles.map((c) => c.aggregateId));

describe("library.browseOwnedPuzzles privacy gating", () => {
  test("the viewer's OWN available copy is excluded by default", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const view = await browse(t);
    expect(ids(view).has("copy-own")).toBe(false);
  });

  test("the viewer's OWN available copy is included with includeOwnPuzzles", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const view = await browse(t, { includeOwnPuzzles: true });
    expect(ids(view).has("copy-own")).toBe(true);
  });

  test("a PUBLIC owner's open copy is shown", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const view = await browse(t);
    expect(ids(view).has("copy-public-open")).toBe(true);
  });

  test("a PUBLIC owner's NON-open copy is excluded", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const view = await browse(t);
    expect(ids(view).has("copy-public-closed")).toBe(false);
  });

  test("a PRIVATE owner's open copy with no shared circle is HIDDEN", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const view = await browse(t);
    expect(ids(view).has("copy-private-hidden")).toBe(false);
  });

  test("a PRIVATE owner's open copy that is circle-shared with the viewer is shown", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const view = await browse(t);
    expect(ids(view).has("copy-circle-open")).toBe(true);
  });

  test("another member's copy never carries owner-only fields", async () => {
    const t = convexTest(schema, modules);
    await seed(t);

    // Stamp the public owner's open copy with owner-only data; browsing it as the viewer must never
    // surface notes / acquisition provenance.
    await t.run(async (ctx) => {
      const copy = await ctx.db
        .query("ownedPuzzles")
        .withIndex("by_aggregate_id", (q) =>
          q.eq("aggregateId", "copy-public-open"),
        )
        .unique();
      if (copy) {
        await ctx.db.patch(copy._id, {
          notes: "owner private notes",
          acquisitionPrice: { amount: 42, currency: "EUR" },
          acquisitionSource: "bought_new",
        });
      }
    });

    const view = await browse(t);
    const shown = view.ownedPuzzles.find(
      (c) => c.aggregateId === "copy-public-open",
    );
    expect(shown).toBeDefined();
    expect(shown?.notes).toBeUndefined();
    expect(shown?.acquisitionPrice).toBeUndefined();
    expect(shown?.acquisitionSource).toBeUndefined();
    expect(JSON.stringify(view)).not.toContain("owner private notes");
  });
});

describe("library.browseOwnedPuzzles puzzleId filter", () => {
  // A second definition with a public-open copy and a private (unreachable) open copy, so the
  // filter is checked both for narrowing and for keeping the visibility rules intact.
  const seedSecondPuzzle = async (t: TestConvex<typeof schema>) =>
    t.run(async (ctx) => {
      const now = Date.now();
      const owner = await ctx.db
        .query("users")
        .withIndex("by_clerk_id", (q) => q.eq("clerkId", "clerk_public"))
        .unique();
      const privateOwner = await ctx.db
        .query("users")
        .withIndex("by_clerk_id", (q) => q.eq("clerkId", "clerk_private"))
        .unique();
      const other = await ctx.db.insert("puzzles", {
        aggregateId: "def-2",
        title: "Harbour Lights",
        pieceCount: 500,
        status: "approved",
        submittedBy: owner!._id,
        createdAt: now,
        updatedAt: now,
      });
      for (const [aggregateId, ownerId] of [
        ["copy-other-public", owner!._id],
        ["copy-other-private", privateOwner!._id],
      ] as const) {
        await ctx.db.insert("ownedPuzzles", {
          aggregateId,
          puzzleId: other,
          ownerId,
          condition: "good",
          availability: OPEN,
          createdAt: now,
          updatedAt: now,
        });
      }
      return other;
    });

  test("returns only copies of that definition", async () => {
    const t = convexTest(schema, modules);
    const { puzzle } = await seed(t);
    await seedSecondPuzzle(t);
    const view = await browse(t, { puzzleId: puzzle });
    expect(ids(view)).toEqual(
      new Set(["copy-public-open", "copy-circle-open"]),
    );
    expect(view.total).toBe(2);
  });

  test("still hides a private owner's copy of the filtered definition", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const other = await seedSecondPuzzle(t);
    const view = await browse(t, { puzzleId: other });
    expect(ids(view)).toEqual(new Set(["copy-other-public"]));
  });

  test("a malformed id yields an empty result, not an error", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const view = await browse(t, { puzzleId: "not-a-real-id" });
    expect(view.ownedPuzzles).toEqual([]);
    expect(view.total).toBe(0);
  });

  test("a well-formed id of a deleted definition yields an empty result", async () => {
    const t = convexTest(schema, modules);
    const { viewer } = await seed(t);
    const gone = await t.run(async (ctx) => {
      const id = await ctx.db.insert("puzzles", {
        title: "Gone",
        pieceCount: 100,
        status: "approved",
        submittedBy: viewer,
        createdAt: 0,
        updatedAt: 0,
      });
      await ctx.db.delete(id);
      return id;
    });
    const view = await browse(t, { puzzleId: gone });
    expect(view.ownedPuzzles).toEqual([]);
  });
});

// SEC-49 / PERF-B9: limit and offset are clamped server-side, whatever the client sends.
describe("library.browseOwnedPuzzles page size", () => {
  const seedManyOpen = (t: TestConvex<typeof schema>, puzzle: Id<"puzzles">) =>
    t.run(async (ctx) => {
      const owner = (await ctx.db
        .query("users")
        .withIndex("by_clerk_id", (q) => q.eq("clerkId", "clerk_public"))
        .unique())!;
      for (let i = 0; i < 60; i++) {
        await ctx.db.insert("ownedPuzzles", {
          aggregateId: `copy-bulk-${i}`,
          puzzleId: puzzle,
          ownerId: owner._id,
          condition: "good",
          availability: OPEN,
          createdAt: i,
          updatedAt: i,
        });
      }
    });

  test("an oversized limit returns at most 50 copies", async () => {
    const t = convexTest(schema, modules);
    const { puzzle } = await seed(t);
    await seedManyOpen(t, puzzle);
    const view = await browse(t, { limit: 1e6 });
    expect(view.ownedPuzzles).toHaveLength(50);
    expect(view.hasMore).toBe(true);
  });

  test("a negative offset reads the first page", async () => {
    const t = convexTest(schema, modules);
    const { puzzle } = await seed(t);
    await seedManyOpen(t, puzzle);
    const first = await browse(t, { limit: 10 });
    const negative = await browse(t, { limit: 10, offset: -5 });
    expect(negative.ownedPuzzles.map((c) => c.aggregateId)).toEqual(
      first.ownedPuzzles.map((c) => c.aggregateId),
    );
    expect(negative.ownedPuzzles).toHaveLength(10);
  });
});

describe("library.browseOwnedPuzzles availability filter", () => {
  // Next to the seed's trade-only copies (the public owner's and the circle-shared one), the public
  // owner offers one copy only for lending and one only for sale. Distinct, later createdAt values
  // keep the newest-first order (and so the pages) deterministic.
  const seedChannels = async (t: TestConvex<typeof schema>) =>
    t.run(async (ctx) => {
      const owner = await ctx.db
        .query("users")
        .withIndex("by_clerk_id", (q) => q.eq("clerkId", "clerk_public"))
        .unique();
      const puzzle = await ctx.db.query("puzzles").first();
      const now = Date.now();
      for (const [aggregateId, availability, createdAt] of [
        ["copy-lend", { forTrade: false, forSale: false, forLend: true }, 1],
        ["copy-sale", { forTrade: false, forSale: true, forLend: false }, 2],
      ] as const) {
        await ctx.db.insert("ownedPuzzles", {
          aggregateId,
          puzzleId: puzzle!._id,
          ownerId: owner!._id,
          condition: "good",
          availability,
          createdAt: now + createdAt,
          updatedAt: now,
        });
      }
    });

  test("one channel returns only copies offered that way, with an exact total", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await seedChannels(t);
    const view = await browse(t, { availability: ["forLend"] });
    expect(ids(view)).toEqual(new Set(["copy-lend"]));
    expect(view.total).toBe(1);
    expect(view.hasMore).toBe(false);
  });

  test("several channels match a copy offered any of those ways", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await seedChannels(t);
    const view = await browse(t, { availability: ["forLend", "forSale"] });
    expect(ids(view)).toEqual(new Set(["copy-lend", "copy-sale"]));
    expect(view.total).toBe(2);
  });

  test("the filter applies to circle-shared copies too", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await seedChannels(t);
    const trade = await browse(t, { availability: ["forTrade"] });
    expect(ids(trade)).toEqual(
      new Set(["copy-public-open", "copy-circle-open"]),
    );
    const lend = await browse(t, { availability: ["forLend"] });
    expect(ids(lend).has("copy-circle-open")).toBe(false);
  });

  test("an empty list does not narrow", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await seedChannels(t);
    const all = await browse(t);
    const empty = await browse(t, { availability: [] });
    expect(empty.total).toBe(all.total);
    expect(ids(empty)).toEqual(ids(all));
  });

  test("filtered pages reach every match once, and only the last page says no more", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await seedChannels(t);
    const availability = ["forTrade", "forSale"];
    const first = await browse(t, { availability, offset: 0, limit: 2 });
    const second = await browse(t, { availability, offset: 2, limit: 2 });
    expect(first.total).toBe(3);
    expect(second.total).toBe(3);
    expect(first.ownedPuzzles).toHaveLength(2);
    expect(first.hasMore).toBe(true);
    expect(second.ownedPuzzles).toHaveLength(1);
    expect(second.hasMore).toBe(false);
    const seen = [...first.ownedPuzzles, ...second.ownedPuzzles].map(
      (c) => c.aggregateId,
    );
    expect(new Set(seen)).toEqual(
      new Set(["copy-public-open", "copy-circle-open", "copy-sale"]),
    );
    expect(seen).toHaveLength(3);
  });
});

describe("library.browseOwnedPuzzles category filter", () => {
  // Files the seeded definition under a category, and adds a second definition under no category
  // with an open copy from the public owner.
  const seedCategory = async (t: TestConvex<typeof schema>) =>
    t.run(async (ctx) => {
      const now = Date.now();
      const category = await ctx.db.insert("adminCategories", {
        name: { en: "Landscapes", nl: "Landschappen" },
        isActive: true,
        sortOrder: 1,
        createdAt: now,
        updatedAt: now,
      });
      const copy = await ctx.db
        .query("ownedPuzzles")
        .filter((q) => q.eq(q.field("aggregateId"), "copy-public-open"))
        .first();
      await ctx.db.patch(copy!.puzzleId, { category });
      const uncategorised = await ctx.db.insert("puzzles", {
        aggregateId: "def-no-category",
        title: "Uncategorised",
        pieceCount: 500,
        status: "approved",
        submittedBy: copy!.ownerId,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("ownedPuzzles", {
        aggregateId: "copy-no-category",
        puzzleId: uncategorised,
        ownerId: copy!.ownerId,
        condition: "good",
        availability: OPEN,
        createdAt: now,
        updatedAt: now,
      });
      return category as string;
    });

  test("narrows to copies of puzzles in that category", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const category = await seedCategory(t);
    const view = await asViewer(t).query(
      api.library.browseOwnedPuzzles.browseOwnedPuzzles,
      { category },
    );
    expect(view.ownedPuzzles.map((c) => c.aggregateId)).not.toContain(
      "copy-no-category",
    );
    expect(view.ownedPuzzles.map((c) => c.aggregateId)).toContain(
      "copy-public-open",
    );
  });

  // It arrives from a URL search param: a hand-edited link must not fail the whole read.
  test("a malformed id yields an empty result, not an error", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await seedCategory(t);
    for (const category of ["notanid", "5"]) {
      const view = await asViewer(t).query(
        api.library.browseOwnedPuzzles.browseOwnedPuzzles,
        { category },
      );
      expect(view).toEqual({ ownedPuzzles: [], total: 0, hasMore: false });
    }
  });

  test("still requires a signed-in member for a malformed id", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await expect(
      t.query(api.library.browseOwnedPuzzles.browseOwnedPuzzles, {
        category: "notanid",
      }),
    ).rejects.toThrow();
  });
});
