import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// The catalog submitter of a puzzle definition is an UNRELATED member as far as an exchange is
// concerned: no exchange read model may carry `submittedBy` or that member's id, for either party,
// before or after the owner acts on the trade.

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

const seed = (t: T) =>
  t.run(async (ctx) => {
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
    const requester = await mkUser("requester", "Rita Requester");
    const owner = await mkUser("owner", "Olivia Owner");
    const submitter = await mkUser("submitter", "Sam Submitter");
    // Both catalog definitions are submitted by the third member, who takes no part in the trade.
    const mkPuzzle = (title: string) =>
      ctx.db.insert("puzzles", {
        title,
        pieceCount: 1000,
        status: "approved",
        submittedBy: submitter,
        createdAt: now,
        updatedAt: now,
      });
    const requestedPuzzle = await mkPuzzle("Harbour Lights");
    const offeredPuzzle = await mkPuzzle("Mountain Lake");
    const mkCopy = (puzzleId: Id<"puzzles">, ownerId: Id<"users">) =>
      ctx.db.insert("ownedPuzzles", {
        puzzleId,
        ownerId,
        condition: "good",
        availability: { forTrade: true, forSale: false, forLend: false },
        createdAt: now,
        updatedAt: now,
      });
    return {
      submitter,
      requestedCopy: await mkCopy(requestedPuzzle, owner),
      offeredCopy: await mkCopy(offeredPuzzle, requester),
    };
  });

const docIdOf = (t: T, aggregateId: string) =>
  t.run(async (ctx) => {
    const row = await ctx.db
      .query("exchanges")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", aggregateId))
      .unique();
    return row!._id;
  });

/** Every exchange read model (plus notifications and the data export) as `who` sees it. */
const allReadModels = async (
  t: T,
  who: string,
  exchangeId: Id<"exchanges">,
  requestedCopy: Id<"ownedPuzzles">,
) => {
  const reader = as(t, who);
  return {
    detail: await reader.query(api.exchange.getExchangeById.getExchangeById, {
      exchangeId,
    }),
    list: await reader.query(
      api.exchange.getUserExchanges.getUserExchanges,
      {},
    ),
    asRequester: await reader.query(
      api.exchange.getExchangesByRequester.getExchangesByRequester,
      {},
    ),
    asOwner: await reader.query(
      api.exchange.getExchangesByOwner.getExchangesByOwner,
      {},
    ),
    partner: await reader.query(api.exchange.getTradePartner.getTradePartner, {
      exchangeId,
    }),
    disclosure: await reader.query(
      api.exchange.getRequestDisclosure.getRequestDisclosure,
      { requestedPuzzleId: requestedCopy },
    ),
    offerable: await reader.query(
      api.exchange.getOfferableCopies.getOfferableCopies,
      { requestedPuzzleId: requestedCopy },
    ),
    notifications: (
      await reader.query(
        api.notifications.listMyNotificationViews.listMyNotificationViews,
        { paginationOpts: { numItems: 50, cursor: null } },
      )
    ).page,
    export: await reader.query(api.insights.exportUserData.exportUserData, {}),
  };
};

const expectNoSubmitter = (payload: unknown, submitter: Id<"users">): void => {
  const json = JSON.stringify(payload);
  expect(json).not.toContain('"submittedBy"');
  expect(json).not.toContain(submitter);
  expect(json).not.toContain("Sam Submitter");
};

describe("exchange views never carry the catalog submitter", () => {
  test("for both parties, before and after the owner accepts", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const aggregateId = await as(t, "requester").mutation(
      api.exchange.propose.propose,
      {
        type: "trade",
        requestedPuzzleId: w.requestedCopy,
        offeredPuzzleId: w.offeredCopy,
      },
    );
    await flush(t);
    const exchangeId = await docIdOf(t, aggregateId);

    for (const who of ["requester", "owner"]) {
      const views = await allReadModels(t, who, exchangeId, w.requestedCopy);
      // Sanity: the views actually carry both catalog definitions.
      expect(views.list[0]!.requestedPuzzle?.title).toBe("Harbour Lights");
      expect(views.list[0]!.offeredPuzzle?.title).toBe("Mountain Lake");
      expect(views.list[0]!.requestedPuzzle).not.toHaveProperty("submittedBy");
      expect(views.list[0]!.offeredPuzzle).not.toHaveProperty("submittedBy");
      expectNoSubmitter(views, w.submitter);
    }

    await as(t, "owner").mutation(api.exchange.accept.accept, {
      exchangeId: aggregateId,
    });
    await flush(t);

    for (const who of ["requester", "owner"]) {
      expectNoSubmitter(
        await allReadModels(t, who, exchangeId, w.requestedCopy),
        w.submitter,
      );
    }
  });
});
