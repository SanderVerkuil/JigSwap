import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob("./**/!(*.test).*s");

// Alice (initiator) proposes a trade to Bob (recipient): she offers her copy of "Ocean Calm" for
// his copy of "Mountain Vista". A second, newer exchange exercises ordering. Plus two messages.
const seed = async (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => {
    const now = Date.now();

    const alice = await ctx.db.insert("users", {
      clerkId: "clerk_alice",
      email: "alice@example.com",
      name: "Alice",
      avatar: "https://img/alice.png",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const bob = await ctx.db.insert("users", {
      clerkId: "clerk_bob",
      email: "bob@example.com",
      name: "Bob",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    const mountain = await ctx.db.insert("puzzles", {
      title: "Mountain Vista",
      pieceCount: 1000,
      status: "approved",
      submittedBy: bob,
      createdAt: now,
      updatedAt: now,
    });
    const ocean = await ctx.db.insert("puzzles", {
      title: "Ocean Calm",
      pieceCount: 500,
      status: "approved",
      submittedBy: alice,
      createdAt: now,
      updatedAt: now,
    });

    const bobsCopy = await ctx.db.insert("ownedPuzzles", {
      puzzleId: mountain,
      ownerId: bob,
      condition: "good",
      availability: { forTrade: true, forSale: false, forLend: false },
      createdAt: now,
      updatedAt: now,
    });
    const alicesCopy = await ctx.db.insert("ownedPuzzles", {
      puzzleId: ocean,
      ownerId: alice,
      condition: "like_new",
      availability: { forTrade: true, forSale: false, forLend: false },
      createdAt: now,
      updatedAt: now,
    });

    const older = await ctx.db.insert("exchanges", {
      aggregateId: "exch-1",
      initiatorId: alice,
      recipientId: bob,
      type: "trade",
      requestedPuzzleId: bobsCopy,
      offeredPuzzleId: alicesCopy,
      status: "proposed",
      createdAt: now - 1000,
      updatedAt: now - 1000,
    });
    const newer = await ctx.db.insert("exchanges", {
      aggregateId: "exch-2",
      initiatorId: alice,
      recipientId: bob,
      type: "trade",
      requestedPuzzleId: bobsCopy,
      status: "completed",
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("messages", {
      exchangeId: older,
      senderId: alice,
      receiverId: bob,
      content: "first",
      messageType: "text",
      isRead: false,
      createdAt: now - 500,
    });
    await ctx.db.insert("messages", {
      exchangeId: older,
      senderId: bob,
      receiverId: alice,
      content: "second",
      messageType: "text",
      isRead: false,
      createdAt: now - 200,
    });

    return { alice, bob, older, newer };
  });

const asAlice = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice" });
const asBob = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_bob" });

describe("exchange.getExchangeById", () => {
  test("returns the exchange with parties and the owned copies", async () => {
    const t = convexTest(schema, modules);
    const { older } = await seed(t);
    const view = await t.query(api.exchange.getExchangeById.getExchangeById, {
      exchangeId: older,
    });
    expect(view?.requester?.name).toBe("Alice");
    expect(view?.owner?.name).toBe("Bob");
    // Legacy naming: ownerPuzzle = requested owned copy, requesterPuzzle = offered owned copy.
    expect(view?.ownerPuzzle?.condition).toBe("good");
    expect(view?.requesterPuzzle?.condition).toBe("like_new");
  });

  test("returns null for a missing exchange", async () => {
    const t = convexTest(schema, modules);
    const { older } = await seed(t);
    await t.run(async (ctx) => ctx.db.delete(older));
    const view = await t.query(api.exchange.getExchangeById.getExchangeById, {
      exchangeId: older,
    });
    expect(view).toBeNull();
  });
});

describe("exchange.getUserExchanges", () => {
  test("tags roles, joins puzzles and sorts newest-first", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);
    const list = await t.query(api.exchange.getUserExchanges.getUserExchanges, {
      userId: alice,
    });
    // Alice is initiator on both (asRequester + asOwner default true; she is recipient on neither).
    expect(list).toHaveLength(2);
    expect(list[0].createdAt).toBeGreaterThanOrEqual(list[1].createdAt);
    const older = list.find((e) => e.aggregateId === "exch-1");
    expect(older?.userRole).toBe("requester");
    expect(older?.requestedPuzzle?.title).toBe("Mountain Vista");
    expect(older?.offeredPuzzle?.title).toBe("Ocean Calm");
  });

  test("filters by status", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);
    const completed = await t.query(
      api.exchange.getUserExchanges.getUserExchanges,
      { userId: alice, status: "completed" },
    );
    expect(completed).toHaveLength(1);
    expect(completed[0].aggregateId).toBe("exch-2");
  });
});

describe("exchange.getExchangesByOwner / getExchangesByRequester", () => {
  test("incoming returns the recipient's exchanges, newest-first", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const incoming = await asBob(t).query(
      api.exchange.getExchangesByOwner.getExchangesByOwner,
      {},
    );
    expect(incoming).toHaveLength(2);
    expect(incoming[0].aggregateId).toBe("exch-2"); // newer first
  });

  test("outgoing returns the initiator's exchanges, newest-first", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const outgoing = await asAlice(t).query(
      api.exchange.getExchangesByRequester.getExchangesByRequester,
      {},
    );
    expect(outgoing).toHaveLength(2);
    expect(outgoing[0].aggregateId).toBe("exch-2");
  });

  test("return [] when unauthenticated", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    expect(
      await t.query(api.exchange.getExchangesByOwner.getExchangesByOwner, {}),
    ).toEqual([]);
    expect(
      await t.query(
        api.exchange.getExchangesByRequester.getExchangesByRequester,
        {},
      ),
    ).toEqual([]);
  });
});

describe("exchange.getExchangeStats", () => {
  test("counts exchanges by status", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const stats = await t.query(
      api.exchange.getExchangeStats.getExchangeStats,
      {},
    );
    expect(stats.total).toBe(2);
    expect(stats.proposed).toBe(1);
    expect(stats.completed).toBe(1);
    expect(stats.rejected).toBe(0);
  });
});

describe("exchange.getExchangeMessages", () => {
  test("returns messages oldest-first with resolved senders", async () => {
    const t = convexTest(schema, modules);
    const { older } = await seed(t);
    const messages = await t.query(
      api.exchange.getExchangeMessages.getExchangeMessages,
      { exchangeId: older },
    );
    expect(messages.map((m) => m.content)).toEqual(["first", "second"]);
    expect(messages[0].sender?.name).toBe("Alice");
    expect(messages[0].sender?.avatar).toBe("https://img/alice.png");
  });
});
