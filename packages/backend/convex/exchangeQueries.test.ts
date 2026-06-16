import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

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
      // Owner-only personal fields — must never reach the counterparty (Alice).
      notes: "bob-private-note-mountain",
      acquisitionSource: "bought_used",
      acquisitionDate: now - 99_999,
      acquisitionPrice: { amount: 4321, currency: "EUR" },
      createdAt: now,
      updatedAt: now,
    });
    const alicesCopy = await ctx.db.insert("ownedPuzzles", {
      puzzleId: ocean,
      ownerId: alice,
      condition: "like_new",
      availability: { forTrade: true, forSale: false, forLend: false },
      // Owner-only personal fields — must never reach the counterparty (Bob).
      notes: "alice-private-note-ocean",
      acquisitionSource: "gift",
      acquisitionDate: now - 88_888,
      acquisitionPrice: { amount: 1234, currency: "USD" },
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
    const view = await asAlice(t).query(
      api.exchange.getExchangeById.getExchangeById,
      {
        exchangeId: older,
      },
    );
    expect(view?.requester?.name).toBe("Alice");
    expect(view?.owner?.name).toBe("Bob");
    // Legacy naming: ownerPuzzle = requested owned copy, requesterPuzzle = offered owned copy.
    expect(view?.ownerPuzzle?.condition).toBe("good");
    expect(view?.requesterPuzzle?.condition).toBe("like_new");
  });

  test("returns null for a non-party caller", async () => {
    const t = convexTest(schema, modules);
    const { older } = await seed(t);
    // Carol is neither initiator nor recipient.
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("users", {
        clerkId: "clerk_carol",
        email: "carol@example.com",
        name: "Carol",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    });
    const view = await t
      .withIdentity({ subject: "clerk_carol" })
      .query(api.exchange.getExchangeById.getExchangeById, {
        exchangeId: older,
      });
    expect(view).toBeNull();
  });

  test("returns null for a missing exchange", async () => {
    const t = convexTest(schema, modules);
    const { older } = await seed(t);
    await t.run(async (ctx) => ctx.db.delete(older));
    const view = await asAlice(t).query(
      api.exchange.getExchangeById.getExchangeById,
      {
        exchangeId: older,
      },
    );
    expect(view).toBeNull();
  });
});

describe("exchange owner-only field gating (counterparty must not see private copy data)", () => {
  // Alice owns Ocean Calm (offered), Bob owns Mountain Vista (requested). On the shared exchange
  // view each party must see owner-only fields (notes + acquisition provenance) ONLY on their own
  // copy, never on the counterparty's. salePrice is public and is not asserted here.
  const BOB_SECRETS = [
    "bob-private-note-mountain",
    "bought_used",
    "4321",
  ] as const;
  const ALICE_SECRETS = ["alice-private-note-ocean", "gift", "1234"] as const;

  test("getExchangeById: each party sees only their own copy's owner-only fields", async () => {
    const t = convexTest(schema, modules);
    const { older } = await seed(t);

    // Alice is the initiator: ownerPuzzle = Bob's requested copy, requesterPuzzle = Alice's offered.
    const aliceView = await asAlice(t).query(
      api.exchange.getExchangeById.getExchangeById,
      { exchangeId: older },
    );
    expect(aliceView?.requesterPuzzle?.notes).toBe("alice-private-note-ocean");
    expect(aliceView?.requesterPuzzle?.acquisitionSource).toBe("gift");
    expect(aliceView?.requesterPuzzle?.acquisitionPrice?.amount).toBe(1234);
    expect(aliceView?.requesterPuzzle?.acquisitionDate).toBeDefined();
    // Bob's copy (the counterparty's) must be stripped of every owner-only field.
    expect(aliceView?.ownerPuzzle?.notes).toBeUndefined();
    expect(aliceView?.ownerPuzzle?.acquisitionSource).toBeUndefined();
    expect(aliceView?.ownerPuzzle?.acquisitionPrice).toBeUndefined();
    expect(aliceView?.ownerPuzzle?.acquisitionDate).toBeUndefined();
    const aliceJson = JSON.stringify(aliceView);
    for (const secret of BOB_SECRETS) {
      expect(aliceJson).not.toContain(secret);
    }

    // Bob is the recipient: he must see his own copy's fields and none of Alice's.
    const bobView = await asBob(t).query(
      api.exchange.getExchangeById.getExchangeById,
      { exchangeId: older },
    );
    expect(bobView?.ownerPuzzle?.notes).toBe("bob-private-note-mountain");
    expect(bobView?.ownerPuzzle?.acquisitionSource).toBe("bought_used");
    expect(bobView?.ownerPuzzle?.acquisitionPrice?.amount).toBe(4321);
    expect(bobView?.requesterPuzzle?.notes).toBeUndefined();
    expect(bobView?.requesterPuzzle?.acquisitionSource).toBeUndefined();
    expect(bobView?.requesterPuzzle?.acquisitionPrice).toBeUndefined();
    expect(bobView?.requesterPuzzle?.acquisitionDate).toBeUndefined();
    const bobJson = JSON.stringify(bobView);
    for (const secret of ALICE_SECRETS) {
      expect(bobJson).not.toContain(secret);
    }
  });

  test("getUserExchanges: initiator never receives the recipient's owner-only fields", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const list = await asAlice(t).query(
      api.exchange.getUserExchanges.getUserExchanges,
      {},
    );
    const older = list.find((e) => e.aggregateId === "exch-1");
    // Alice owns the offered copy; she sees its owner-only fields.
    expect(older?.offeredOwnedPuzzle?.notes).toBe("alice-private-note-ocean");
    // Bob's requested copy is the counterparty's — stripped.
    expect(older?.requestedOwnedPuzzle?.notes).toBeUndefined();
    expect(older?.requestedOwnedPuzzle?.acquisitionSource).toBeUndefined();
    expect(older?.requestedOwnedPuzzle?.acquisitionPrice).toBeUndefined();
    const json = JSON.stringify(list);
    for (const secret of BOB_SECRETS) {
      expect(json).not.toContain(secret);
    }
  });

  test("getExchangesByOwner: recipient never receives the initiator's owner-only fields", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const incoming = await asBob(t).query(
      api.exchange.getExchangesByOwner.getExchangesByOwner,
      {},
    );
    const older = incoming.find((e) => e.aggregateId === "exch-1");
    // Bob owns the requested copy; he sees its owner-only fields.
    expect(older?.requestedOwnedPuzzle?.notes).toBe(
      "bob-private-note-mountain",
    );
    // Alice's offered copy is the counterparty's — stripped.
    expect(older?.offeredOwnedPuzzle?.notes).toBeUndefined();
    expect(older?.offeredOwnedPuzzle?.acquisitionSource).toBeUndefined();
    expect(older?.offeredOwnedPuzzle?.acquisitionPrice).toBeUndefined();
    const json = JSON.stringify(incoming);
    for (const secret of ALICE_SECRETS) {
      expect(json).not.toContain(secret);
    }
  });
});

describe("exchange.getUserExchanges", () => {
  test("tags roles, joins puzzles and sorts newest-first", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const list = await asAlice(t).query(
      api.exchange.getUserExchanges.getUserExchanges,
      {},
    );
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
    await seed(t);
    const completed = await asAlice(t).query(
      api.exchange.getUserExchanges.getUserExchanges,
      { status: "completed" },
    );
    expect(completed).toHaveLength(1);
    expect(completed[0].aggregateId).toBe("exch-2");
  });

  test("filters by the schema status 'rejected' (not the legacy 'declined')", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seed(t);
    // A rejected exchange that the legacy `declined` literal could never match.
    await t.run(async (ctx) => {
      const now = Date.now();
      const puzzle = await ctx.db.insert("puzzles", {
        title: "Forest",
        pieceCount: 250,
        status: "approved",
        submittedBy: bob,
        createdAt: now,
        updatedAt: now,
      });
      const copy = await ctx.db.insert("ownedPuzzles", {
        puzzleId: puzzle,
        ownerId: bob,
        condition: "good",
        availability: { forTrade: true, forSale: false, forLend: false },
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("exchanges", {
        aggregateId: "exch-3",
        initiatorId: alice,
        recipientId: bob,
        type: "trade",
        requestedPuzzleId: copy,
        status: "rejected",
        createdAt: now + 1000,
        updatedAt: now + 1000,
      });
    });
    const rejected = await asAlice(t).query(
      api.exchange.getUserExchanges.getUserExchanges,
      { status: "rejected" },
    );
    expect(rejected).toHaveLength(1);
    expect(rejected[0].aggregateId).toBe("exch-3");
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
    const messages = await asAlice(t).query(
      api.exchange.getExchangeMessages.getExchangeMessages,
      { exchangeId: older },
    );
    expect(messages.map((m) => m.content)).toEqual(["first", "second"]);
    expect(messages[0].sender?.name).toBe("Alice");
    expect(messages[0].sender?.avatar).toBe("https://img/alice.png");
  });
});
