import { convexTest, type TestConvex } from "convex-test";
import { ConvexError } from "convex/values";
import { beforeEach, describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// The requester's offerable copies for a swap request. Ann and Bob share a household; Cat and Dan
// are outsiders. Bob is the requester. The list must match exactly what `propose` accepts as the
// offered copy: owned, or household-co-managed ("manage"), never a "view"-only household copy and
// never a copy owned by the request's recipient.

type T = TestConvex<typeof schema>;
type Who = "ann" | "bob" | "cat" | "dan";

const as = (t: T, who: Who) => t.withIdentity({ subject: `clerk_${who}` });

interface World {
  ann: Id<"users">;
  bob: Id<"users">;
  cat: Id<"users">;
  dan: Id<"users">;
  annManage: Id<"ownedPuzzles">; // Ann's household copy at "manage" (default)
  annView: Id<"ownedPuzzles">; // Ann's household copy at "view"
  annOpen: Id<"ownedPuzzles">; // Ann's tradeable copy
  bobOwn: Id<"ownedPuzzles">; // Bob's own copy (closed)
  catOpen: Id<"ownedPuzzles">; // Cat's tradeable copy
  catOther: Id<"ownedPuzzles">; // another Cat copy
  danHidden: Id<"ownedPuzzles">; // Dan's closed copy, Dan private
}

const seed = async (t: T): Promise<World> => {
  const world = await t.run(async (ctx) => {
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
    const ann = await mkUser("clerk_ann", "Ann");
    const bob = await mkUser("clerk_bob", "Bob");
    const cat = await mkUser("clerk_cat", "Cat");
    const dan = await mkUser("clerk_dan", "Dan");
    await ctx.db.insert("profiles", {
      memberId: dan,
      visibility: "private",
      updatedAt: now,
    });
    const puzzleId = await ctx.db.insert("puzzles", {
      title: "Shelf",
      pieceCount: 1000,
      status: "approved",
      submittedBy: ann,
      createdAt: now,
      updatedAt: now,
    });
    const closed = { forTrade: false, forSale: false, forLend: false };
    const open = { forTrade: true, forSale: false, forLend: false };
    const mkCopy = (
      aggregateId: string,
      ownerId: Id<"users">,
      extra: Record<string, unknown> = {},
    ) =>
      ctx.db.insert("ownedPuzzles", {
        aggregateId,
        puzzleId,
        ownerId,
        condition: "good",
        availability: closed,
        snapshot: { title: `Shelf ${aggregateId}`, pieceCount: 1000 },
        createdAt: now,
        updatedAt: now,
        ...extra,
      });
    return {
      ann,
      bob,
      cat,
      dan,
      annManage: await mkCopy("ann-manage", ann),
      annView: await mkCopy("ann-view", ann, { householdPermission: "view" }),
      annOpen: await mkCopy("ann-open", ann, { availability: open }),
      bobOwn: await mkCopy("bob-own", bob),
      catOpen: await mkCopy("cat-open", cat, { availability: open }),
      catOther: await mkCopy("cat-other", cat),
      danHidden: await mkCopy("dan-hidden", dan),
    };
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

const offerable = (t: T, who: Who, requestedPuzzleId: Id<"ownedPuzzles">) =>
  as(t, who).query(api.exchange.getOfferableCopies.getOfferableCopies, {
    requestedPuzzleId,
  });

const idsOf = (rows: { _id: string }[]) => rows.map((r) => r._id).sort();

let t: T;
let w: World;

beforeEach(async () => {
  t = convexTest(schema, modules);
  w = await seed(t);
});

describe("getOfferableCopies", () => {
  test("requires authentication", async () => {
    await expect(
      t.query(api.exchange.getOfferableCopies.getOfferableCopies, {
        requestedPuzzleId: w.catOpen,
      }),
    ).rejects.toBeInstanceOf(ConvexError);
  });

  test("lists owned and household-managed copies, not view-only ones", async () => {
    const rows = await offerable(t, "bob", w.catOpen);
    expect(idsOf(rows)).toEqual([w.annManage, w.annOpen, w.bobOwn].sort());
    const own = rows.find((r) => r._id === w.bobOwn);
    expect(own?.ownedByViewer).toBe(true);
    const managed = rows.find((r) => r._id === w.annManage);
    expect(managed?.ownedByViewer).toBe(false);
    expect(managed?.owner?.memberId).toBe(w.ann);
  });

  test("never lists the target owner's own copies", async () => {
    // Bob requests Ann's copy: Ann is the recipient, so her co-managed copies drop out.
    const rows = await offerable(t, "bob", w.annOpen);
    expect(idsOf(rows)).toEqual([w.bobOwn]);
  });

  test("never lists other members' copies", async () => {
    const rows = await offerable(t, "cat", w.annOpen);
    expect(idsOf(rows)).toEqual([w.catOpen, w.catOther].sort());
  });

  test("is empty when the requested copy is not viewable", async () => {
    expect(await offerable(t, "bob", w.danHidden)).toEqual([]);
  });

  test("every listed copy is accepted by propose as the offered copy", async () => {
    const rows = await offerable(t, "bob", w.catOpen);
    for (const row of rows) {
      const exchangeId = await as(t, "bob").mutation(
        api.exchange.propose.propose,
        {
          recipientId: w.cat,
          type: "trade",
          requestedPuzzleId: w.catOpen,
          offeredPuzzleId: row._id as Id<"ownedPuzzles">,
        },
      );
      // Cancel so the next proposal for the same requested copy isn't a duplicate.
      await as(t, "bob").mutation(api.exchange.cancel.cancel, { exchangeId });
    }
  });
});
