import { LIBRARY_ROWS_MAX } from "@jigswap/contracts";
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { COLLECTION_ROWS_MAX } from "./library/getCollectionById";
import { COLLECTION_MEMBER_VERIFICATIONS } from "./library/getUserCollections";
import schema from "./schema";

// Every library read that joins each copy to its card must hold under Convex's real limit of 4,096
// index ranges per function, at the most expensive row a member can have: its own definition with box
// art and renditions lookups, and a cover photo still being checked, which costs a read and then falls
// back to that box art. Past a read's cap the oldest rows drop out; the read must not fail.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);
type T = TestConvex<typeof schema>;

const BASE = 1_700_000_000_000;
const OPEN = { forTrade: true, forSale: false, forLend: false };
const CLOSED = { forTrade: false, forSale: false, forLend: false };

const limited = () => convexTest({ schema, modules, transactionLimits: true });

const mkUser = (ctx: MutationCtx, name: string) =>
  ctx.db.insert("users", {
    clerkId: `clerk_${name}`,
    email: `${name}@example.com`,
    name,
    isActive: true,
    createdAt: BASE,
    updatedAt: BASE,
  });

const as = (t: T, name: string) => t.withIdentity({ subject: `clerk_${name}` });

// `count` copies, oldest first, each the most expensive row there is.
const seedCopies = async (
  t: T,
  ownerId: Id<"users">,
  count: number,
  fields: Partial<Doc<"ownedPuzzles">> = {},
) => {
  const image = await t.run((ctx) =>
    ctx.storage.store(new Blob(["x"], { type: "image/webp" })),
  );
  const ids: Id<"ownedPuzzles">[] = [];
  for (let start = 0; start < count; start += 200) {
    const made = await t.run(async (ctx) => {
      const out: Id<"ownedPuzzles">[] = [];
      for (let i = start; i < Math.min(count, start + 200); i++) {
        const puzzleId = await ctx.db.insert("puzzles", {
          title: `p${i}`,
          pieceCount: 1000,
          status: "approved",
          image,
          submittedBy: ownerId,
          createdAt: BASE,
          updatedAt: BASE,
        });
        const copyId = await ctx.db.insert("ownedPuzzles", {
          aggregateId: `${ownerId}-copy-${i}`,
          puzzleId,
          ownerId,
          condition: "good",
          availability: CLOSED,
          createdAt: BASE + i,
          updatedAt: BASE + i,
          ...fields,
        });
        const cover = await ctx.db.insert("ownedPuzzleImages", {
          ownedPuzzleId: copyId,
          uploaderId: ownerId,
          fileId: image,
          moderationStatus: "pending",
          createdAt: BASE,
          updatedAt: BASE,
        });
        await ctx.db.patch(copyId, { coverImageId: cover });
        out.push(copyId);
      }
      return out;
    });
    ids.push(...made);
  }
  return ids;
};

const seedHousehold = (t: T, members: Id<"users">[]) =>
  t.run(async (ctx) => {
    await ctx.db.insert("households", { aggregateId: "hh", createdAt: BASE });
    for (const [i, memberId] of members.entries()) {
      await ctx.db.insert("householdMembers", {
        householdId: "hh",
        memberId,
        role: i === 0 ? "admin" : "member",
        joinedAt: BASE,
      });
    }
  });

const seedCollection = async (
  t: T,
  userId: Id<"users">,
  copies: readonly Id<"ownedPuzzles">[],
  visibility: "private" | "public" = "private",
) => {
  const collectionId = await t.run((ctx) =>
    ctx.db.insert("collections", {
      aggregateId: crypto.randomUUID(),
      userId,
      name: `collection-${crypto.randomUUID()}`,
      isDefault: false,
      visibility,
      createdAt: BASE,
      updatedAt: BASE,
    }),
  );
  for (let start = 0; start < copies.length; start += 400) {
    await t.run(async (ctx) => {
      for (const [i, ownedPuzzleId] of copies
        .slice(start, start + 400)
        .entries()) {
        await ctx.db.insert("collectionMembers", {
          collectionId,
          ownedPuzzleId,
          addedAt: BASE + start + i,
        });
      }
    });
  }
  return collectionId;
};

const OVER = LIBRARY_ROWS_MAX + 5;

describe("the pickers that join every copy", () => {
  test("library.ownedByOwner: the owner's newest copies come back, not a thrown read", async () => {
    const t = limited();
    const me = await t.run((ctx) => mkUser(ctx, "me"));
    const ids = await seedCopies(t, me, OVER);

    const rows = await as(t, "me").query(
      api.library.getOwnedPuzzlesByOwner.getOwnedPuzzlesByOwner,
      { ownerId: me, includeUnavailable: true },
    );

    expect(rows).toHaveLength(LIBRARY_ROWS_MAX);
    expect(rows[0]._id).toBe(ids[OVER - 1]);
  }, 300_000);

  test("exchange.offerableCopies: the newest copies come back, not a thrown read", async () => {
    const t = limited();
    const { me, other } = await t.run(async (ctx) => ({
      me: await mkUser(ctx, "me"),
      other: await mkUser(ctx, "other"),
    }));
    await seedCopies(t, me, OVER, { availability: OPEN, isOpen: true });
    const [requested] = await seedCopies(t, other, 1, {
      availability: OPEN,
      isOpen: true,
    });

    const rows = await as(t, "me").query(
      api.exchange.getOfferableCopies.getOfferableCopies,
      { requestedPuzzleId: requested },
    );

    expect(rows).toHaveLength(LIBRARY_ROWS_MAX);
  }, 300_000);

  test("household.copies: a housemate's newest copies come back, not a thrown read", async () => {
    const t = limited();
    const { me, mate } = await t.run(async (ctx) => ({
      me: await mkUser(ctx, "me"),
      mate: await mkUser(ctx, "mate"),
    }));
    await seedHousehold(t, [me, mate]);
    await seedCopies(t, mate, OVER);

    const rows = await as(t, "me").query(
      api.household.listHouseholdCopies.listHouseholdCopies,
      {},
    );

    expect(rows).toHaveLength(LIBRARY_ROWS_MAX);
  }, 300_000);

  test("household.mine: the member's newest copies come back, not a thrown read", async () => {
    const t = limited();
    const { me, mate } = await t.run(async (ctx) => ({
      me: await mkUser(ctx, "me"),
      mate: await mkUser(ctx, "mate"),
    }));
    await seedHousehold(t, [me, mate]);
    await seedCopies(t, me, OVER);

    const rows = await as(t, "me").query(
      api.household.listMyHouseholdCopyPermissions
        .listMyHouseholdCopyPermissions,
      {},
    );

    expect(rows).toHaveLength(LIBRARY_ROWS_MAX);
  }, 300_000);
});

describe("My Puzzles' windows", () => {
  test("library.myLibraryWindow and myLibraryCopies hold at their maximum", async () => {
    const t = limited();
    const me = await t.run((ctx) => mkUser(ctx, "me"));
    const ids = await seedCopies(t, me, OVER);

    const window = await as(t, "me").query(
      api.library.listMyLibraryWindow.listMyLibraryWindow,
      { limit: LIBRARY_ROWS_MAX + 1000 },
    );
    expect(window.rows).toHaveLength(LIBRARY_ROWS_MAX);
    expect(window.hasMore).toBe(true);

    const rows = await as(t, "me").query(
      api.library.getMyLibraryCopies.getMyLibraryCopies,
      { copyIds: ids },
    );
    expect(rows).toHaveLength(LIBRARY_ROWS_MAX);
  }, 300_000);
});

describe("library.collections.byId", () => {
  test("the owner gets the newest members and is told there are more", async () => {
    const t = limited();
    const me = await t.run((ctx) => mkUser(ctx, "me"));
    const count = COLLECTION_ROWS_MAX + 5;
    const ids = await seedCopies(t, me, count);
    const collectionId = await seedCollection(t, me, ids);

    const view = await as(t, "me").query(
      api.library.getCollectionById.getCollectionById,
      { collectionId },
    );

    expect(view?.puzzles).toHaveLength(COLLECTION_ROWS_MAX);
    expect(view?.hasMorePuzzles).toBe(true);
    // Oldest first as ever, from the newest members.
    expect(view?.puzzles[0]._id).toBe(ids[5]);
    expect(view?.puzzles[COLLECTION_ROWS_MAX - 1]._id).toBe(ids[count - 1]);
  }, 300_000);

  test("a collection that fits says nothing is left out", async () => {
    const t = limited();
    const me = await t.run((ctx) => mkUser(ctx, "me"));
    const ids = await seedCopies(t, me, 3);
    const collectionId = await seedCollection(t, me, ids);

    const view = await as(t, "me").query(
      api.library.getCollectionById.getCollectionById,
      { collectionId },
    );

    expect(view?.puzzles.map((p) => p._id)).toEqual(ids);
    expect(view?.hasMorePuzzles).toBe(false);
  });

  test("another member's public collection holds too, at its most expensive", async () => {
    const t = limited();
    const { owner } = await t.run(async (ctx) => ({
      viewer: await mkUser(ctx, "viewer"),
      owner: await mkUser(ctx, "owner"),
    }));
    // Private copies: each costs the gate's own reads before it is dropped.
    const hidden = await seedCopies(t, owner, COLLECTION_ROWS_MAX + 5, {
      visibility: "private",
      visibilityAuthoritative: true,
    });
    const collectionId = await seedCollection(t, owner, hidden, "public");

    const view = await as(t, "viewer").query(
      api.library.getCollectionById.getCollectionById,
      { collectionId },
    );

    expect(view?.puzzles).toEqual([]);
    expect(view?.hasMorePuzzles).toBe(true);
  }, 300_000);
});

describe("library.collections.listForUser", () => {
  test("two collections holding the same 2,100 copies are counted, not a thrown read", async () => {
    const t = limited();
    const me = await t.run((ctx) => mkUser(ctx, "me"));
    const ids = await seedCopies(t, me, 2100);
    await seedCollection(t, me, ids);
    await seedCollection(t, me, ids);

    const views = await as(t, "me").query(
      api.library.getUserCollections.getUserCollections,
      {},
    );

    expect(views.map((view) => view.puzzleCount)).toEqual([2100, 2100]);
  }, 300_000);

  test("past the verification budget another member's count stops instead of guessing", async () => {
    const t = limited();
    const { owner } = await t.run(async (ctx) => ({
      viewer: await mkUser(ctx, "viewer"),
      owner: await mkUser(ctx, "owner"),
    }));
    const ids = await seedCopies(
      t,
      owner,
      COLLECTION_MEMBER_VERIFICATIONS.other + 5,
      {
        availability: OPEN,
        isOpen: true,
      },
    );
    await seedCollection(t, owner, ids, "public");

    const [view] = await as(t, "viewer").query(
      api.library.getUserCollections.getUserCollections,
      { userId: owner },
    );

    expect(view.puzzleCount).toBe(COLLECTION_MEMBER_VERIFICATIONS.other);
  }, 300_000);
});
