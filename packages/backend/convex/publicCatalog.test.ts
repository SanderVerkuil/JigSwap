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
    avatar: `https://avatars/${clerkId}.png`,
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
