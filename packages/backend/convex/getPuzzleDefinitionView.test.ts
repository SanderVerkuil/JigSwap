import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const DAY = 86_400_000;

const asViewer = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_viewer" });

const mkUser = (
  ctx: MutationCtx,
  clerkId: string,
  name: string,
  now: number,
  extra: { location?: string } = {},
) =>
  ctx.db.insert("users", {
    clerkId,
    email: `${clerkId}@example.com`,
    name,
    username: clerkId,
    avatar: `https://avatars/${clerkId}.png`,
    location: extra.location,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });

// Seed the viewer + one approved catalog puzzle. Returns ids for per-test enrichment.
const seed = async (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => {
    const now = 1_000_000;
    const viewer = await mkUser(ctx, "clerk_viewer", "Viewer", now);

    const puzzleId = await ctx.db.insert("puzzles", {
      aggregateId: "def-1",
      title: "Secret Garden",
      brand: "Ravensburger",
      pieceCount: 1000,
      description: "A lush garden.",
      tags: ["landscape", "1000pc"],
      difficulty: "hard",
      status: "approved",
      submittedBy: viewer,
      createdAt: now,
      updatedAt: now,
    });

    return { now, viewer, puzzleId };
  });

const setVisibility = (
  t: ReturnType<typeof convexTest>,
  memberId: Id<"users">,
  visibility: "public" | "private",
) =>
  t.run(async (ctx) => {
    await ctx.db.insert("profiles", {
      aggregateId: `prof-${memberId}`,
      memberId,
      displayName: "X",
      visibility,
      updatedAt: 1,
    });
  });

const mkCopy = (
  t: ReturnType<typeof convexTest>,
  args: {
    aggregateId: string;
    puzzleId: Id<"puzzles">;
    ownerId: Id<"users">;
    condition?: "new_sealed" | "like_new" | "good" | "fair" | "poor";
    availability?: { forTrade: boolean; forSale: boolean; forLend: boolean };
    createdAt: number;
  },
) =>
  t.run(async (ctx) =>
    ctx.db.insert("ownedPuzzles", {
      aggregateId: args.aggregateId,
      puzzleId: args.puzzleId,
      ownerId: args.ownerId,
      condition: args.condition ?? "good",
      availability: args.availability ?? {
        forTrade: false,
        forSale: false,
        forLend: false,
      },
      createdAt: args.createdAt,
      updatedAt: args.createdAt,
    }),
  );

const get = (t: ReturnType<typeof convexTest>, puzzleId: Id<"puzzles">) =>
  asViewer(t).query(
    api.library.getPuzzleDefinitionView.getPuzzleDefinitionView,
    { puzzleId },
  );

describe("getPuzzleDefinitionView", () => {
  test("auth is required", async () => {
    const t = convexTest(schema, modules);
    const { puzzleId } = await seed(t);
    await expect(
      t.query(api.library.getPuzzleDefinitionView.getPuzzleDefinitionView, {
        puzzleId,
      }),
    ).rejects.toThrow();
  });

  test("unknown puzzle returns null", async () => {
    const t = convexTest(schema, modules);
    const { puzzleId } = await seed(t);
    // Delete the puzzle, keep a valid-shaped id by inserting+deleting.
    const orphan = await t.run(async (ctx) => {
      const id = await ctx.db.insert("puzzles", {
        title: "Gone",
        pieceCount: 100,
        status: "approved",
        submittedBy: (await ctx.db.query("users").first())!._id,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.delete(id);
      return id;
    });
    expect(await get(t, orphan)).toBeNull();
    // Sanity: the seeded puzzle is found.
    expect(await get(t, puzzleId)).not.toBeNull();
  });

  test("definition surfaces title/brand/pieceCount/tags/difficulty/description + categoryName.en", async () => {
    const t = convexTest(schema, modules);
    const { puzzleId } = await seed(t);
    const categoryId = await t.run(async (ctx) =>
      ctx.db.insert("adminCategories", {
        name: { en: "Landscapes", nl: "Landschappen" },
        isActive: true,
        sortOrder: 0,
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    await t.run(async (ctx) => {
      await ctx.db.patch(puzzleId, { category: categoryId });
    });

    const view = await get(t, puzzleId);
    expect(view?.definition.title).toBe("Secret Garden");
    expect(view?.definition.brand).toBe("Ravensburger");
    expect(view?.definition.pieceCount).toBe(1000);
    expect(view?.definition.tags).toEqual(["landscape", "1000pc"]);
    expect(view?.definition.difficulty).toBe("hard");
    expect(view?.definition.description).toBe("A lush garden.");
    expect(view?.definition.categoryName).toBe("Landscapes");
  });

  test("rating aggregate + percentages over rated puzzleComments (reviews)", async () => {
    const t = convexTest(schema, modules);
    const { now, viewer, puzzleId } = await seed(t);

    await t.run(async (ctx) => {
      // ratings 5,5,3,1 -> count 4, sum 14, avg 3.5; breakdown [2,0,1,0,1];
      // percentages [50,0,25,0,25].
      for (const rating of [5, 5, 3, 1]) {
        await ctx.db.insert("puzzleComments", {
          aggregateId: crypto.randomUUID(),
          puzzleId,
          authorId: viewer,
          text: "review",
          rating,
          createdAt: now,
        });
      }
      // A text-only review (no rating) is excluded from count/avg/breakdown/percentages.
      await ctx.db.insert("puzzleComments", {
        aggregateId: crypto.randomUUID(),
        puzzleId,
        authorId: viewer,
        text: "no stars",
        createdAt: now,
      });
    });

    const view = await get(t, puzzleId);
    expect(view?.rating.count).toBe(4);
    expect(view?.rating.rating).toBe(3.5);
    expect(view?.rating.breakdown).toEqual([2, 0, 1, 0, 1]);
    expect(view?.rating.percentages).toEqual([50, 0, 25, 0, 25]);
  });

  test("rating is 0/empty when there are no rated reviews", async () => {
    const t = convexTest(schema, modules);
    const { puzzleId } = await seed(t);
    const view = await get(t, puzzleId);
    expect(view?.rating.count).toBe(0);
    expect(view?.rating.rating).toBe(0);
    expect(view?.rating.breakdown).toEqual([0, 0, 0, 0, 0]);
    expect(view?.rating.percentages).toEqual([0, 0, 0, 0, 0]);
  });

  test("stats: communityOwners distinct, totalCompletions, avgCompletionDays, availableToSwap", async () => {
    const t = convexTest(schema, modules);
    const { now, viewer, puzzleId } = await seed(t);

    const alice = await t.run((ctx) =>
      mkUser(ctx, "clerk_alice", "Alice", now),
    );
    const bob = await t.run((ctx) => mkUser(ctx, "clerk_bob", "Bob", now));
    await setVisibility(t, alice, "public");
    await setVisibility(t, bob, "public");

    // Owners: viewer (1 copy), alice (2 copies -> still ONE distinct owner), bob (1 copy) = 3 distinct.
    await mkCopy(t, {
      aggregateId: "c-viewer",
      puzzleId,
      ownerId: viewer,
      createdAt: now,
    });
    await mkCopy(t, {
      aggregateId: "c-alice-1",
      puzzleId,
      ownerId: alice,
      availability: { forTrade: true, forSale: false, forLend: false },
      createdAt: now + 1,
    });
    await mkCopy(t, {
      aggregateId: "c-alice-2",
      puzzleId,
      ownerId: alice,
      availability: { forTrade: false, forSale: true, forLend: false },
      createdAt: now + 2,
    });
    await mkCopy(t, {
      aggregateId: "c-bob",
      puzzleId,
      ownerId: bob,
      availability: { forTrade: false, forSale: false, forLend: true },
      createdAt: now + 3,
    });

    await t.run(async (ctx) => {
      // Completed completions of the DEFINITION: finish-days 4 and 6 -> avg 5. One in-progress excluded.
      await ctx.db.insert("completions", {
        userId: viewer,
        puzzleId,
        startDate: now,
        endDate: now + 4 * DAY,
        photos: [],
        isCompleted: true,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("completions", {
        userId: alice,
        puzzleId,
        startDate: now,
        endDate: now + 6 * DAY,
        photos: [],
        isCompleted: true,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("completions", {
        userId: bob,
        puzzleId,
        startDate: now,
        photos: [],
        isCompleted: false,
        createdAt: now,
        updatedAt: now,
      });
    });

    const view = await get(t, puzzleId);
    expect(view?.stats.communityOwners).toBe(3);
    expect(view?.stats.totalCompletions).toBe(2);
    expect(view?.stats.avgCompletionDays).toBe(5);
    // availableToSwap: alice's 2 + bob's 1 = 3 reachable available copies (viewer's own excluded).
    expect(view?.stats.availableToSwap).toBe(3);
  });

  test("avgCompletionDays is null when no completed completions", async () => {
    const t = convexTest(schema, modules);
    const { puzzleId } = await seed(t);
    const view = await get(t, puzzleId);
    expect(view?.stats.totalCompletions).toBe(0);
    expect(view?.stats.avgCompletionDays).toBeNull();
  });

  test("ownership true with condition when the viewer owns a copy", async () => {
    const t = convexTest(schema, modules);
    const { now, viewer, puzzleId } = await seed(t);
    const copy = await mkCopy(t, {
      aggregateId: "c-viewer",
      puzzleId,
      ownerId: viewer,
      condition: "like_new",
      createdAt: now,
    });

    const view = await get(t, puzzleId);
    expect(view?.ownership.viewerOwns).toBe(true);
    expect(view?.ownership.copyId).toBe(copy as string);
    expect(view?.ownership.condition).toBe("like_new");
  });

  test("ownership false with null condition when the viewer owns none", async () => {
    const t = convexTest(schema, modules);
    const { puzzleId } = await seed(t);
    const view = await get(t, puzzleId);
    expect(view?.ownership.viewerOwns).toBe(false);
    expect(view?.ownership.copyId).toBeNull();
    expect(view?.ownership.condition).toBeNull();
  });

  test("availableCopies: excludes own, excludes private non-circle, includes public + circle-shared; swapType + owner avgRating; totalAvailable", async () => {
    const t = convexTest(schema, modules);
    const { now, viewer, puzzleId } = await seed(t);

    const publicOwner = await t.run((ctx) =>
      mkUser(ctx, "clerk_pub", "Public Owner", now, { location: "Berlin" }),
    );
    const privateOwner = await t.run((ctx) =>
      mkUser(ctx, "clerk_priv", "Private Owner", now),
    );
    const circleOwner = await t.run((ctx) =>
      mkUser(ctx, "clerk_circ", "Circle Owner", now),
    );
    await setVisibility(t, publicOwner, "public");
    await setVisibility(t, privateOwner, "private");
    await setVisibility(t, circleOwner, "private");

    // Owner reputation: public owner has avg 4.6 over 5 reviews; circle owner has no reviews -> null.
    await t.run(async (ctx) => {
      await ctx.db.insert("reputationProfiles", {
        memberId: publicOwner,
        ratingSum: 23,
        reviewCount: 5,
        averageRating: 4.6,
        credibility: 1,
        updatedAt: now,
      });
    });

    // Viewer's OWN available copy — must be excluded from availableCopies.
    await mkCopy(t, {
      aggregateId: "c-viewer",
      puzzleId,
      ownerId: viewer,
      availability: { forTrade: true, forSale: false, forLend: false },
      createdAt: now,
    });
    // Public owner: forTrade -> "swap".
    const pubCopy = await mkCopy(t, {
      aggregateId: "c-pub",
      puzzleId,
      ownerId: publicOwner,
      availability: { forTrade: true, forSale: true, forLend: false },
      createdAt: now + 10,
    });
    // Private, non-circle owner: must NOT appear.
    await mkCopy(t, {
      aggregateId: "c-priv",
      puzzleId,
      ownerId: privateOwner,
      availability: { forTrade: true, forSale: false, forLend: false },
      createdAt: now + 20,
    });
    // Circle owner (private) — reachable only via a shared circle. forLend (no forTrade) -> "lend".
    const circCopy = await mkCopy(t, {
      aggregateId: "c-circ",
      puzzleId,
      ownerId: circleOwner,
      availability: { forTrade: false, forSale: false, forLend: true },
      createdAt: now + 30,
    });

    // Build a circle the viewer + circleOwner belong to, and share the circleOwner's copy into it.
    // Wired exactly as collectCircleSharedCopies reads it (mirrors browseOwnedPuzzles.test.ts):
    // circleMembers.by_member for the viewer's circles, circleCopyShares.by_circle keyed on the
    // circle aggregateId, and copy resolution by the copy's aggregateId.
    await t.run(async (ctx) => {
      const circleAggregateId = "circle-1";
      await ctx.db.insert("circles", {
        aggregateId: circleAggregateId,
        ownerId: circleOwner,
        name: "Friends",
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
        await ctx.db.insert("circleMembers", { circleAggregateId, memberId });
      }
      await ctx.db.insert("circleCopyShares", {
        circleId: circleAggregateId,
        copyId: "c-circ",
        sharedAt: now,
      });
    });

    const view = await get(t, puzzleId);

    // Reachable available copies: public + circle = 2 (private non-circle excluded, viewer's own excluded).
    expect(view?.totalAvailable).toBe(2);
    expect(view?.stats.availableToSwap).toBe(2);
    expect(view?.availableCopies).toHaveLength(2);

    // Newest first: circle copy (now+30) precedes public copy (now+10).
    const byCopyId = new Map(
      (view?.availableCopies ?? []).map((c) => [c.copyId, c]),
    );
    expect(view?.availableCopies[0]?.copyId).toBe(circCopy as string);
    expect(view?.availableCopies[1]?.copyId).toBe(pubCopy as string);

    const pub = byCopyId.get(pubCopy as string)!;
    expect(pub.swapType).toBe("swap");
    expect(pub.owner.name).toBe("Public Owner");
    expect(pub.owner.location).toBe("Berlin");
    expect(pub.owner.avatarUrl).toBe("https://avatars/clerk_pub.png");
    expect(pub.owner.avgRating).toBe(4.6);

    const circ = byCopyId.get(circCopy as string)!;
    expect(circ.swapType).toBe("lend");
    expect(circ.owner.name).toBe("Circle Owner");
    expect(circ.owner.avgRating).toBeNull();

    // Adversarial: the private non-circle owner never leaks into the offered list.
    const serialized = JSON.stringify(view?.availableCopies);
    expect(serialized).not.toContain("Private Owner");
  });

  test("swapType priority: forSale-only maps to sale", async () => {
    const t = convexTest(schema, modules);
    const { now, puzzleId } = await seed(t);
    const owner = await t.run((ctx) => mkUser(ctx, "clerk_s", "Seller", now));
    await setVisibility(t, owner, "public");
    const copy = await mkCopy(t, {
      aggregateId: "c-sale",
      puzzleId,
      ownerId: owner,
      availability: { forTrade: false, forSale: true, forLend: false },
      createdAt: now,
    });
    const view = await get(t, puzzleId);
    expect(view?.availableCopies).toHaveLength(1);
    expect(view?.availableCopies[0]?.copyId).toBe(copy as string);
    expect(view?.availableCopies[0]?.swapType).toBe("sale");
  });

  test("availableCopies caps at 5 but totalAvailable counts all", async () => {
    const t = convexTest(schema, modules);
    const { now, puzzleId } = await seed(t);
    for (let i = 0; i < 7; i++) {
      const owner = await t.run((ctx) =>
        mkUser(ctx, `clerk_o${i}`, `Owner ${i}`, now),
      );
      await setVisibility(t, owner, "public");
      await mkCopy(t, {
        aggregateId: `c-${i}`,
        puzzleId,
        ownerId: owner,
        availability: { forTrade: true, forSale: false, forLend: false },
        createdAt: now + i,
      });
    }
    const view = await get(t, puzzleId);
    expect(view?.totalAvailable).toBe(7);
    expect(view?.stats.availableToSwap).toBe(7);
    expect(view?.availableCopies).toHaveLength(5);
  });
});
