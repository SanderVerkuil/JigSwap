import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// A requester may offer a copy owned by a household mate (mayOfferCopy: co-managed). The mate is
// NOT a party to the exchange, so the counterparty owner must never receive the mate's raw id (or
// name) through the offered copy's `ownerId`.

type T = TestConvex<typeof schema>;
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const as = (t: T, who: string) => t.withIdentity({ subject: `clerk_${who}` });

// The dispatcher runs via runAfter(0); yield a macrotask then drain, a few times to settle chains.
const flush = async (t: T) => {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await t.finishInProgressScheduledFunctions();
  }
};

const seed = async (t: T) => {
  const world = await t.run(async (ctx) => {
    const now = 1_000_000;
    const mkUser = (who: string, name: string) =>
      ctx.db.insert("users", {
        clerkId: `clerk_${who}`,
        email: `${who}@example.com`,
        name,
        username: who,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const mate = await mkUser("mate", "Mia Mate");
    const requester = await mkUser("requester", "Rita Requester");
    const owner = await mkUser("owner", "Olivia Owner");
    const puzzleId = await ctx.db.insert("puzzles", {
      title: "Harbour Lights",
      pieceCount: 1000,
      status: "approved",
      submittedBy: owner,
      createdAt: now,
      updatedAt: now,
    });
    const mkCopy = (ownerId: Id<"users">) =>
      ctx.db.insert("ownedPuzzles", {
        puzzleId,
        ownerId,
        condition: "good",
        availability: { forTrade: true, forSale: false, forLend: false },
        createdAt: now,
        updatedAt: now,
      });
    return {
      mate,
      requester,
      owner,
      mateCopy: await mkCopy(mate),
      ownerCopy: await mkCopy(owner),
    };
  });
  // The mate and the requester share a household (default permission: manage).
  await as(t, "mate").mutation(
    api.household.createHousehold.createHousehold,
    {},
  );
  const inviteId = await as(t, "mate").mutation(
    api.household.inviteToHousehold.inviteToHousehold,
    { inviteeId: world.requester },
  );
  await as(t, "requester").mutation(
    api.household.acceptHouseholdInvite.acceptHouseholdInvite,
    { inviteId },
  );
  return world;
};

const docIdOf = (t: T, aggregateId: string) =>
  t.run(async (ctx) => {
    const row = await ctx.db
      .query("exchanges")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", aggregateId))
      .unique();
    return row!._id;
  });

const views = async (t: T, who: string, exchangeId: Id<"exchanges">) => {
  const reader = as(t, who);
  return {
    detail: await reader.query(api.exchange.getExchangeById.getExchangeById, {
      exchangeId,
    }),
    list: await reader.query(
      api.exchange.getUserExchanges.getUserExchanges,
      {},
    ),
    asOwner: await reader.query(
      api.exchange.getExchangesByOwner.getExchangesByOwner,
      {},
    ),
    asRequester: await reader.query(
      api.exchange.getExchangesByRequester.getExchangesByRequester,
      {},
    ),
  };
};

describe("an offered household-mate copy never discloses the mate", () => {
  test("to the owner, before and after accept; the requester's views keep the trade", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const aggregateId = await as(t, "requester").mutation(
      api.exchange.propose.propose,
      {
        type: "trade",
        requestedPuzzleId: w.ownerCopy,
        offeredPuzzleId: w.mateCopy,
      },
    );
    await flush(t);
    const exchangeId = await docIdOf(t, aggregateId);

    const check = async () => {
      const ownerViews = await views(t, "owner", exchangeId);
      // Sanity: the owner does see the offered copy itself.
      expect(ownerViews.detail?.requesterPuzzle?._id).toBe(w.mateCopy);
      expect(ownerViews.asOwner[0]!.offeredOwnedPuzzle?._id).toBe(w.mateCopy);
      expect(ownerViews.detail?.requesterPuzzle).not.toHaveProperty("ownerId");
      expect(ownerViews.list[0]!.offeredOwnedPuzzle).not.toHaveProperty(
        "ownerId",
      );
      const json = JSON.stringify(ownerViews);
      expect(json).not.toContain(w.mate);
      expect(json).not.toContain("Mia Mate");
      // The owner still sees the requester (owner always sees the requester) and their own copy.
      expect(ownerViews.detail?.initiatorId).toBe(w.requester);
      expect(ownerViews.detail?.ownerPuzzle?.ownerId).toBe(w.owner);

      const requesterViews = await views(t, "requester", exchangeId);
      expect(requesterViews.detail?.initiatorId).toBe(w.requester);
      expect(requesterViews.detail?.requesterPuzzle?._id).toBe(w.mateCopy);
      expect(requesterViews.asRequester[0]!.offeredOwnedPuzzle?._id).toBe(
        w.mateCopy,
      );
      expect(requesterViews.asRequester[0]!.requestedOwnedPuzzle?._id).toBe(
        w.ownerCopy,
      );
    };

    await check();
    await as(t, "owner").mutation(api.exchange.accept.accept, {
      exchangeId: aggregateId,
    });
    await flush(t);
    await check();
  });
});
