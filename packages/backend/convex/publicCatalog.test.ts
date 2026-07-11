import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const NOW = 1_000_000;

const mkUser = (
  ctx: MutationCtx,
  clerkId: string,
  name: string,
  extra: { shareAvatarPublicly?: boolean } = {},
) =>
  ctx.db.insert("users", {
    clerkId,
    email: `${clerkId}@example.com`,
    name,
    username: clerkId,
    avatar: `https://avatars/${clerkId.replace("clerk_", "")}.png`,
    location: "Utrecht",
    shareAvatarPublicly: extra.shareAvatarPublicly,
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
  });

const mkProfile = (
  ctx: MutationCtx,
  memberId: Id<"users">,
  visibility: "public" | "private",
) =>
  ctx.db.insert("profiles", {
    aggregateId: `prof-${memberId}`,
    memberId,
    displayName: "X",
    visibility,
    updatedAt: NOW,
  });

const mkCopy = (
  ctx: MutationCtx,
  slug: string,
  puzzleId: Id<"puzzles">,
  ownerId: Id<"users">,
  availability: { forTrade: boolean; forSale: boolean; forLend: boolean },
) =>
  ctx.db.insert("ownedPuzzles", {
    aggregateId: `copy-${slug}`,
    puzzleId,
    ownerId,
    condition: "good",
    availability,
    createdAt: NOW,
    updatedAt: NOW,
  });

// Seed: an approved + a pending definition, three owners (public/public/private profiles) with
// open + closed copies, and reviews by a public- and a private-profile author.
const seed = async (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => {
    const pia = await mkUser(ctx, "clerk_pia", "Pia Public", {
      shareAvatarPublicly: true,
    });
    const paul = await mkUser(ctx, "clerk_paul", "Paul Public"); // no avatar consent
    const priya = await mkUser(ctx, "clerk_priya", "Priya Private");
    await mkProfile(ctx, pia, "public");
    await mkProfile(ctx, paul, "public");
    await mkProfile(ctx, priya, "private");

    const approved = await ctx.db.insert("puzzles", {
      aggregateId: "def-approved",
      title: "Mountain Vista",
      brand: "Ravensburger",
      pieceCount: 1000,
      difficulty: "hard",
      tags: ["nature"],
      searchableText: "mountain vista ravensburger",
      status: "approved",
      submittedBy: pia,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const pending = await ctx.db.insert("puzzles", {
      aggregateId: "def-pending",
      title: "Secret Ocean",
      brand: "Clementoni",
      pieceCount: 500,
      searchableText: "secret ocean clementoni",
      status: "pending",
      submittedBy: pia,
      createdAt: NOW,
      updatedAt: NOW,
    });

    // Copies of the approved puzzle:
    //  pia (public):   open forTrade  -> counts as "swap"
    //  paul (public):  open forLend   -> counts as "lend"
    //  paul (public):  closed         -> not counted (but still an owner)
    //  priya (private): open forTrade -> NOT counted publicly
    await mkCopy(ctx, "pia-trade", approved, pia, {
      forTrade: true,
      forSale: false,
      forLend: false,
    });
    await mkCopy(ctx, "paul-lend", approved, paul, {
      forTrade: false,
      forSale: false,
      forLend: true,
    });
    await mkCopy(ctx, "paul-closed", approved, paul, {
      forTrade: false,
      forSale: false,
      forLend: false,
    });
    await mkCopy(ctx, "priya-trade", approved, priya, {
      forTrade: true,
      forSale: false,
      forLend: false,
    });

    // Definition-level reviews (copyId == null): one by a public profile, one by a private one.
    await ctx.db.insert("puzzleComments", {
      aggregateId: "rev-pia",
      puzzleId: approved,
      authorId: pia,
      text: "Lovely gradient sky.",
      rating: 5,
      createdAt: NOW + 1,
    });
    await ctx.db.insert("puzzleComments", {
      aggregateId: "rev-priya",
      puzzleId: approved,
      authorId: priya,
      text: "Tough edges!",
      rating: 3,
      createdAt: NOW + 2,
    });
    // A review on the PENDING puzzle must never surface publicly.
    await ctx.db.insert("puzzleComments", {
      aggregateId: "rev-pending",
      puzzleId: pending,
      authorId: pia,
      text: "Should not leak.",
      rating: 4,
      createdAt: NOW + 3,
    });

    return { pia, paul, priya, approved, pending };
  });

describe("getPublicDefinitionView", () => {
  test("returns catalog facts + aggregates for an approved definition, unauthenticated", async () => {
    const t = convexTest(schema, modules);
    const { approved } = await seed(t);

    const view = await t.query(
      api.catalog.getPublicDefinitionView.getPublicDefinitionView,
      { puzzleId: approved },
    );
    expect(view).not.toBeNull();
    expect(view?.definition.title).toBe("Mountain Vista");
    expect(view?.definition.brand).toBe("Ravensburger");
    expect(view?.definition.pieceCount).toBe(1000);
    // Rating over the two definition reviews: (5+3)/2 = 4.
    expect(view?.rating.rating).toBe(4);
    expect(view?.rating.count).toBe(2);
    // 3 distinct owners overall.
    expect(view?.stats.communityOwners).toBe(3);
  });

  test("availability counts only OPEN copies of PUBLIC-profile owners, with per-type breakdown", async () => {
    const t = convexTest(schema, modules);
    const { approved } = await seed(t);

    const view = await t.query(
      api.catalog.getPublicDefinitionView.getPublicDefinitionView,
      { puzzleId: approved },
    );
    // pia's forTrade (swap) + paul's forLend (lend). priya's open copy is private-owner; paul's
    // closed copy is not open. NOTE: this intentionally differs from the member-facing count.
    expect(view?.availability).toEqual({
      total: 2,
      byType: { swap: 1, lend: 1, sale: 0 },
    });
  });

  test("public availability is intentionally asymmetric to the member-facing count (private owner + closed copy excluded)", async () => {
    const t = convexTest(schema, modules);
    const { approved } = await seed(t);

    const view = await t.query(
      api.catalog.getPublicDefinitionView.getPublicDefinitionView,
      { puzzleId: approved },
    );
    // There are 3 OPEN copies of this definition (pia swap, paul lend, priya swap) plus 1 closed.
    // The public view counts only the 2 open copies of PUBLIC-profile owners — it deliberately
    // excludes priya's open copy (private owner). This asymmetry is by design (publicAvailabilityOf
    // has no circle reachability and no viewer): the public total (2) must be LESS than the raw
    // open-copy total (3), proving the private owner's copy never leaks into the public count.
    expect(view?.availability.total).toBe(2);
    expect(view?.availability.total).toBeLessThan(3);
  });

  test("returns null for a non-approved definition", async () => {
    const t = convexTest(schema, modules);
    const { pending } = await seed(t);

    expect(
      await t.query(
        api.catalog.getPublicDefinitionView.getPublicDefinitionView,
        { puzzleId: pending },
      ),
    ).toBeNull();
  });

  test("payload leaks no member identity or copy-level data", async () => {
    const t = convexTest(schema, modules);
    const { approved } = await seed(t);

    const view = await t.query(
      api.catalog.getPublicDefinitionView.getPublicDefinitionView,
      { puzzleId: approved },
    );
    const raw = JSON.stringify(view);
    expect(raw).not.toContain("ownerId");
    expect(raw).not.toContain("Pia Public");
    expect(raw).not.toContain("Priya Private");
    expect(raw).not.toContain("clerk_");
    expect(raw).not.toContain("Utrecht");
    expect(raw).not.toContain("condition");
  });
});

describe("listPublicPuzzleReviews", () => {
  test("names public-profile authors, anonymizes private-profile authors", async () => {
    const t = convexTest(schema, modules);
    const { approved } = await seed(t);

    const reviews = await t.query(
      api.social.listPublicPuzzleReviews.listPublicPuzzleReviews,
      { puzzleId: approved },
    );
    // Newest first: rev-priya (private author), then rev-pia (public author).
    expect(reviews).toHaveLength(2);
    expect(reviews[0].author).toBeNull(); // Priya: private profile -> "A JigSwap member"
    expect(reviews[0].text).toBe("Tough edges!");
    expect(reviews[1].author?.name).toBe("Pia Public");
    // Pia consented (shareAvatarPublicly: true) -> avatar included.
    expect(reviews[1].author?.avatar).toBe("https://avatars/pia.png");
  });

  test("withholds the avatar without shareAvatarPublicly consent, even for public profiles", async () => {
    const t = convexTest(schema, modules);
    const { approved, paul } = await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("puzzleComments", {
        aggregateId: "rev-paul",
        puzzleId: approved,
        authorId: paul,
        text: "Great fit.",
        rating: 4,
        createdAt: NOW + 10,
      });
    });

    const reviews = await t.query(
      api.social.listPublicPuzzleReviews.listPublicPuzzleReviews,
      { puzzleId: approved },
    );
    const paulsReview = reviews.find((r) => r.text === "Great fit.");
    expect(paulsReview?.author?.name).toBe("Paul Public");
    expect(paulsReview?.author?.avatar).toBeNull();
  });

  test("returns [] for a non-approved definition (reviews must not leak)", async () => {
    const t = convexTest(schema, modules);
    const { pending } = await seed(t);

    expect(
      await t.query(
        api.social.listPublicPuzzleReviews.listPublicPuzzleReviews,
        { puzzleId: pending },
      ),
    ).toEqual([]);
  });

  test("payload never carries username/location/bio/member ids", async () => {
    const t = convexTest(schema, modules);
    const { approved } = await seed(t);

    const raw = JSON.stringify(
      await t.query(
        api.social.listPublicPuzzleReviews.listPublicPuzzleReviews,
        { puzzleId: approved },
      ),
    );
    expect(raw).not.toContain("clerk_"); // usernames equal clerk ids in the seed
    expect(raw).not.toContain("Utrecht");
    expect(raw).not.toContain("authorId");
    expect(raw).not.toContain("email");
  });
});

describe("browsePublicCatalog", () => {
  const firstPage = { numItems: 20, cursor: null };

  test("lists approved definitions only, newest first, with card aggregates", async () => {
    const t = convexTest(schema, modules);
    await seed(t);

    const result = await t.query(
      api.catalog.browsePublicCatalog.browsePublicCatalog,
      { paginationOpts: firstPage },
    );
    expect(result.page).toHaveLength(1); // pending stays hidden
    const card = result.page[0];
    expect(card.title).toBe("Mountain Vista");
    expect(card.rating).toEqual({ value: 4, count: 2 });
    expect(card.availableToSwap).toBe(2); // public-owner open copies only
  });

  test("search term restricts via the search index (approved-only)", async () => {
    const t = convexTest(schema, modules);
    await seed(t);

    const hit = await t.query(
      api.catalog.browsePublicCatalog.browsePublicCatalog,
      { paginationOpts: firstPage, searchTerm: "mountain" },
    );
    expect(hit.page.map((p) => p.title)).toEqual(["Mountain Vista"]);

    // The pending puzzle's terms must not surface.
    const miss = await t.query(
      api.catalog.browsePublicCatalog.browsePublicCatalog,
      { paginationOpts: firstPage, searchTerm: "secret ocean" },
    );
    expect(miss.page).toHaveLength(0);
  });

  test("brand and piece-count filters narrow the list", async () => {
    const t = convexTest(schema, modules);
    const { pia } = await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("puzzles", {
        aggregateId: "def-small",
        title: "Tiny Meadow",
        brand: "Jumbo",
        pieceCount: 300,
        searchableText: "tiny meadow jumbo",
        status: "approved",
        submittedBy: pia,
        createdAt: NOW + 5,
        updatedAt: NOW + 5,
      });
    });

    const byBrand = await t.query(
      api.catalog.browsePublicCatalog.browsePublicCatalog,
      { paginationOpts: firstPage, brand: "Jumbo" },
    );
    expect(byBrand.page.map((p) => p.title)).toEqual(["Tiny Meadow"]);

    const byPieces = await t.query(
      api.catalog.browsePublicCatalog.browsePublicCatalog,
      { paginationOpts: firstPage, pieceMin: 1000, pieceMax: 1499 },
    );
    expect(byPieces.page.map((p) => p.title)).toEqual(["Mountain Vista"]);

    const under500 = await t.query(
      api.catalog.browsePublicCatalog.browsePublicCatalog,
      { paginationOpts: firstPage, pieceMax: 499 },
    );
    expect(under500.page.map((p) => p.title)).toEqual(["Tiny Meadow"]);
  });

  test("card payload leaks no owner or member data", async () => {
    const t = convexTest(schema, modules);
    await seed(t);

    const raw = JSON.stringify(
      await t.query(api.catalog.browsePublicCatalog.browsePublicCatalog, {
        paginationOpts: firstPage,
      }),
    );
    expect(raw).not.toContain("ownerId");
    expect(raw).not.toContain("submittedBy");
    expect(raw).not.toContain("clerk_");
  });
});

describe("listSitemapEntries", () => {
  test("returns approved definition ids + updatedAt only", async () => {
    const t = convexTest(schema, modules);
    const { approved } = await seed(t);

    const entries = await t.query(
      api.catalog.listSitemapEntries.listSitemapEntries,
      {},
    );
    expect(entries).toEqual([{ id: approved, updatedAt: NOW }]);
  });
});
