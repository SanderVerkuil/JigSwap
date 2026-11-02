import { convexTest, type TestConvex } from "convex-test";
import { ConvexError } from "convex/values";
import { beforeEach, describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { effectiveCopyVisibility } from "./library/copyVisibility";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// library.updateCopiesOffers: My Puzzles' bulk "Offer for swap / Offer to lend / Withdraw offers".
// Ann owns the copies; Bob shares her household (he manages her copies by default, but not the one
// she set to view-only); Cat is a stranger.

type T = TestConvex<typeof schema>;
type Who = "ann" | "bob" | "cat";

const as = (t: T, who: Who) => t.withIdentity({ subject: `clerk_${who}` });

const CLOSED = { forTrade: false, forSale: false, forLend: false };

interface World {
  ann: Id<"users">;
  bob: Id<"users">;
  puzzleId: Id<"puzzles">;
}

const seed = async (t: T): Promise<World> => {
  const world = await t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (who: Who) =>
      ctx.db.insert("users", {
        clerkId: `clerk_${who}`,
        email: `${who}@example.com`,
        name: who,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const ann = await mkUser("ann");
    const bob = await mkUser("bob");
    await mkUser("cat");
    const puzzleId = await ctx.db.insert("puzzles", {
      aggregateId: "def-harbour",
      title: "Harbour Lights",
      pieceCount: 1000,
      status: "approved",
      submittedBy: ann,
      createdAt: now,
      updatedAt: now,
    });
    return { ann, bob, puzzleId };
  });

  await as(t, "ann").mutation(
    api.household.createHousehold.createHousehold,
    {},
  );
  const inviteId = await as(t, "ann").mutation(
    api.household.inviteToHousehold.inviteToHousehold,
    { inviteeId: world.bob },
  );
  await as(t, "bob").mutation(
    api.household.acceptHouseholdInvite.acceptHouseholdInvite,
    { inviteId },
  );
  return world;
};

// One of Ann's copies (domain id `aggregateId`), closed and visible unless `extra` says otherwise.
const seedCopy = (
  t: T,
  w: World,
  aggregateId: string,
  extra: Partial<Doc<"ownedPuzzles">> = {},
) =>
  t.run((ctx) =>
    ctx.db.insert("ownedPuzzles", {
      aggregateId,
      puzzleId: w.puzzleId,
      puzzleDefinitionId: "def-harbour",
      ownerId: w.ann,
      condition: "good",
      availability: CLOSED,
      visibility: "visible",
      visibilityAuthoritative: true,
      snapshot: { title: "Harbour Lights", pieceCount: 1000 },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...extra,
    }),
  );

const rowOf = (t: T, id: Id<"ownedPuzzles">) =>
  t.run(async (ctx) => {
    const row = await ctx.db.get(id);
    if (!row) throw new Error("copy missing");
    return row;
  });

const updateOffers = (
  t: T,
  who: Who,
  args: {
    copyIds: string[];
    forTrade?: boolean;
    forLend?: boolean;
    forSale?: boolean;
  },
) =>
  as(t, who).mutation(api.library.updateCopiesOffers.updateCopiesOffers, args);

const WITHDRAW = { forTrade: false, forLend: false, forSale: false };

let t: T;
let w: World;

beforeEach(async () => {
  t = convexTest(schema, modules);
  w = await seed(t);
});

describe("library.updateCopiesOffers", () => {
  test("requires authentication", async () => {
    await seedCopy(t, w, "copy-a");
    await expect(
      t.mutation(api.library.updateCopiesOffers.updateCopiesOffers, {
        copyIds: ["copy-a"],
        forTrade: true,
      }),
    ).rejects.toThrow("Unauthenticated");
  });

  test("the owner offers copies for swap; each keeps the offers it already had", async () => {
    const closed = await seedCopy(t, w, "copy-closed");
    const lent = await seedCopy(t, w, "copy-lend", {
      availability: { ...CLOSED, forLend: true },
    });

    const result = await updateOffers(t, "ann", {
      copyIds: ["copy-closed", "copy-lend"],
      forTrade: true,
    });

    expect(result).toEqual({ updated: 2, unchanged: 0, skipped: [] });
    expect((await rowOf(t, closed)).availability).toEqual({
      ...CLOSED,
      forTrade: true,
    });
    expect((await rowOf(t, lent)).availability).toEqual({
      ...CLOSED,
      forTrade: true,
      forLend: true,
    });
  });

  test("a private copy stays the owner's private choice: visible while offered, private once withdrawn", async () => {
    const id = await seedCopy(t, w, "copy-private", { visibility: "private" });

    await updateOffers(t, "ann", { copyIds: ["copy-private"], forLend: true });
    const offered = await rowOf(t, id);
    expect(offered.visibility).toBe("private");
    expect(effectiveCopyVisibility(offered)).toBe("visible");

    await updateOffers(t, "ann", { copyIds: ["copy-private"], ...WITHDRAW });
    const withdrawn = await rowOf(t, id);
    expect(withdrawn.availability).toEqual(CLOSED);
    expect(withdrawn.visibility).toBe("private");
    expect(effectiveCopyVisibility(withdrawn)).toBe("private");
  });

  test("withdraw clears every offer, sale included, and keeps the sale price", async () => {
    const id = await seedCopy(t, w, "copy-all", {
      availability: { forTrade: true, forLend: true, forSale: true },
      salePrice: { amount: 1500, currency: "EUR" },
    });

    const result = await updateOffers(t, "ann", {
      copyIds: ["copy-all"],
      ...WITHDRAW,
    });

    expect(result).toEqual({ updated: 1, unchanged: 0, skipped: [] });
    const row = await rowOf(t, id);
    expect(row.availability).toEqual(CLOSED);
    expect(row.salePrice).toEqual({ amount: 1500, currency: "EUR" });
  });

  test("a copy already as asked is counted unchanged and not rewritten", async () => {
    const id = await seedCopy(t, w, "copy-swap", {
      availability: { ...CLOSED, forTrade: true },
      updatedAt: 1,
    });

    const result = await updateOffers(t, "ann", {
      copyIds: ["copy-swap"],
      forTrade: true,
    });

    expect(result).toEqual({ updated: 0, unchanged: 1, skipped: [] });
    expect((await rowOf(t, id)).updatedAt).toBe(1);
  });

  test("a stranger's batch changes nothing and learns nothing: every copy is notAllowed", async () => {
    const closed = await seedCopy(t, w, "copy-closed");
    await seedCopy(t, w, "copy-swap", {
      availability: { ...CLOSED, forTrade: true },
    });

    const result = await updateOffers(t, "cat", {
      copyIds: ["copy-closed", "copy-swap", "no-such-copy"],
      forTrade: true,
    });

    expect(result).toEqual({
      updated: 0,
      unchanged: 0,
      skipped: [
        { copyId: "copy-closed", reason: "notAllowed" },
        { copyId: "copy-swap", reason: "notAllowed" },
        { copyId: "no-such-copy", reason: "notAllowed" },
      ],
    });
    expect((await rowOf(t, closed)).availability).toEqual(CLOSED);
  });

  test("a household member may offer the copies they manage, not a view-only one", async () => {
    const managed = await seedCopy(t, w, "copy-managed");
    const viewOnly = await seedCopy(t, w, "copy-view", {
      householdPermission: "view",
    });

    const result = await updateOffers(t, "bob", {
      copyIds: ["copy-managed", "copy-view"],
      forLend: true,
    });

    expect(result).toEqual({
      updated: 1,
      unchanged: 0,
      skipped: [{ copyId: "copy-view", reason: "notAllowed" }],
    });
    expect((await rowOf(t, managed)).availability.forLend).toBe(true);
    expect((await rowOf(t, viewOnly)).availability.forLend).toBe(false);
  });

  test("a copy an active exchange reserves is skipped when offering, and the rest still change", async () => {
    const reserved = await seedCopy(t, w, "copy-reserved");
    const free = await seedCopy(t, w, "copy-free");
    await t.run(async (ctx) => {
      await ctx.db.insert("exchanges", {
        aggregateId: crypto.randomUUID(),
        initiatorId: w.bob,
        recipientId: w.ann,
        type: "trade",
        requestedPuzzleId: reserved,
        status: "proposed",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const result = await updateOffers(t, "ann", {
      copyIds: ["copy-reserved", "copy-free"],
      forTrade: true,
    });

    expect(result).toEqual({
      updated: 1,
      unchanged: 0,
      skipped: [{ copyId: "copy-reserved", reason: "reserved" }],
    });
    expect((await rowOf(t, reserved)).availability.forTrade).toBe(false);
    expect((await rowOf(t, free)).availability.forTrade).toBe(true);
  });

  test("a copy out on loan stays off the market, for its owner and for a housemate who manages it", async () => {
    const onLoan = await seedCopy(t, w, "copy-on-loan", { heldBy: w.bob });
    const free = await seedCopy(t, w, "copy-free");

    const byOwner = await updateOffers(t, "ann", {
      copyIds: ["copy-on-loan", "copy-free"],
      forTrade: true,
    });
    expect(byOwner).toEqual({
      updated: 1,
      unchanged: 0,
      skipped: [{ copyId: "copy-on-loan", reason: "onLoan" }],
    });

    const byHousemate = await updateOffers(t, "bob", {
      copyIds: ["copy-on-loan"],
      forLend: true,
    });
    expect(byHousemate).toEqual({
      updated: 0,
      unchanged: 0,
      skipped: [{ copyId: "copy-on-loan", reason: "onLoan" }],
    });

    expect((await rowOf(t, onLoan)).availability).toEqual(CLOSED);
    expect((await rowOf(t, free)).availability.forTrade).toBe(true);
  });

  test("a copy out on loan that is on offer anyway can still be withdrawn", async () => {
    const onLoan = await seedCopy(t, w, "copy-on-loan", {
      heldBy: w.bob,
      availability: { ...CLOSED, forTrade: true },
    });

    await expect(
      updateOffers(t, "ann", { copyIds: ["copy-on-loan"], ...CLOSED }),
    ).resolves.toEqual({ updated: 1, unchanged: 0, skipped: [] });

    expect((await rowOf(t, onLoan)).availability).toEqual(CLOSED);
  });

  test("a stranger learns nothing about a copy being out on loan", async () => {
    await seedCopy(t, w, "copy-on-loan", { heldBy: w.bob });
    const result = await updateOffers(t, "cat", {
      copyIds: ["copy-on-loan"],
      forTrade: true,
    });
    expect(result).toEqual({
      updated: 0,
      unchanged: 0,
      skipped: [{ copyId: "copy-on-loan", reason: "notAllowed" }],
    });
  });

  test("more than 100 distinct copies are refused before anything is written", async () => {
    const id = await seedCopy(t, w, "copy-0");
    const copyIds = [
      "copy-0",
      ...Array.from({ length: 100 }, (_, i) => `copy-${i + 1}`),
    ];

    const attempt = updateOffers(t, "ann", { copyIds, forTrade: true });
    await expect(attempt).rejects.toBeInstanceOf(ConvexError);
    await attempt.catch((e: unknown) => {
      expect((e as ConvexError<{ code: string }>).data.code).toBe(
        "OffersBatchTooLarge",
      );
    });
    expect((await rowOf(t, id)).availability.forTrade).toBe(false);
  });
});
