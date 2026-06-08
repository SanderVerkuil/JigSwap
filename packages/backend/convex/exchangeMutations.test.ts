import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob("./**/!(*.test).*s");

type Avail = { forTrade: boolean; forSale: boolean; forLend: boolean };

const ALL_FALSE: Avail = { forTrade: false, forSale: false, forLend: false };

// Seed two users and a shared puzzle; copies are added per test with explicit availability.
const seed = async (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (clerkId: string, email: string) =>
      ctx.db.insert("users", {
        clerkId,
        email,
        name: clerkId,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const alice = await mkUser("clerk_alice", "alice@example.com");
    const bob = await mkUser("clerk_bob", "bob@example.com");
    const puzzleId = await ctx.db.insert("puzzles", {
      title: "Test Puzzle",
      pieceCount: 1000,
      status: "approved",
      submittedBy: alice,
      createdAt: now,
      updatedAt: now,
    });
    return { puzzleId, alice, bob };
  });

const addCopy = (
  t: ReturnType<typeof convexTest>,
  puzzleId: Id<"puzzles">,
  ownerId: Id<"users">,
  availability: Avail,
) =>
  t.run(async (ctx) => {
    const now = Date.now();
    return ctx.db.insert("ownedPuzzles", {
      puzzleId,
      ownerId,
      condition: "good",
      availability,
      createdAt: now,
      updatedAt: now,
    });
  });

const getCopy = (t: ReturnType<typeof convexTest>, id: Id<"ownedPuzzles">) =>
  t.run(async (ctx) => ctx.db.get(id));

const notificationsFor = (t: ReturnType<typeof convexTest>, userId: Id<"users">) =>
  t.run(async (ctx) =>
    ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect(),
  );

const exchangeRow = (t: ReturnType<typeof convexTest>, aggregateId: string) =>
  t.run(async (ctx) =>
    ctx.db
      .query("exchanges")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", aggregateId))
      .unique(),
  );

const asAlice = (t: ReturnType<typeof convexTest>) => t.withIdentity({ subject: "clerk_alice" });
const asBob = (t: ReturnType<typeof convexTest>) => t.withIdentity({ subject: "clerk_bob" });

// convex-test serializes ConvexError.data to a JSON string when it crosses the function
// boundary, so normalise before asserting on the stable `code`.
const dataOf = (e: unknown): { code?: string } => {
  const data = (e as ConvexError<unknown>).data;
  return typeof data === "string" ? JSON.parse(data) : (data as { code?: string });
};

const expectConvexCode = async (p: Promise<unknown>, code: string) => {
  await expect(p).rejects.toBeInstanceOf(ConvexError);
  await p.catch((e: unknown) => {
    expect(dataOf(e).code).toBe(code);
  });
};

describe("exchange.propose", () => {
  test("requires authentication", async () => {
    const t = convexTest(schema, modules);
    const { bob, puzzleId } = await seed(t);
    const copy = await addCopy(t, puzzleId, bob, { ...ALL_FALSE, forSale: true });
    await expect(
      t.mutation(api.exchange.propose.propose, {
        recipientId: bob,
        type: "sale",
        requestedPuzzleId: copy,
        salePrice: 1000,
      }),
    ).rejects.toThrow("Unauthenticated");
  });

  test("availability TRUE for the kind => ok (fixed vs the old inverted check)", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, puzzleId } = await seed(t);
    const copy = await addCopy(t, puzzleId, bob, { ...ALL_FALSE, forSale: true });
    const id = await asAlice(t).mutation(api.exchange.propose.propose, {
      recipientId: bob,
      type: "sale",
      requestedPuzzleId: copy,
      salePrice: 1500,
    });
    expect(typeof id).toBe("string");
    const row = await exchangeRow(t, id);
    expect(row?.status).toBe("proposed");
    expect(row?.type).toBe("sale");
    expect(row?.initiatorId).toBe(alice); // derived from auth, not args
    expect(row?.salePrice).toEqual({ amount: 1500, currency: "EUR" });
  });

  test("availability FALSE for the kind => CopyNotAvailable", async () => {
    const t = convexTest(schema, modules);
    const { bob, puzzleId } = await seed(t);
    const copy = await addCopy(t, puzzleId, bob, ALL_FALSE);
    await expectConvexCode(
      asAlice(t).mutation(api.exchange.propose.propose, {
        recipientId: bob,
        type: "sale",
        requestedPuzzleId: copy,
        salePrice: 1000,
      }),
      "CopyNotAvailable",
    );
  });

  test("swap requires the offered copy to be owned by the initiator", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, puzzleId } = await seed(t);
    const requested = await addCopy(t, puzzleId, bob, { ...ALL_FALSE, forTrade: true });
    const notMine = await addCopy(t, puzzleId, bob, { ...ALL_FALSE, forTrade: true });
    await expectConvexCode(
      asAlice(t).mutation(api.exchange.propose.propose, {
        recipientId: bob,
        type: "trade",
        requestedPuzzleId: requested,
        offeredPuzzleId: notMine,
      }),
      "OfferedCopyNotOwned",
    );
    const mine = await addCopy(t, puzzleId, alice, { ...ALL_FALSE, forTrade: true });
    const id = await asAlice(t).mutation(api.exchange.propose.propose, {
      recipientId: bob,
      type: "trade",
      requestedPuzzleId: requested,
      offeredPuzzleId: mine,
    });
    const row = await exchangeRow(t, id);
    expect(row?.offeredPuzzleId).toBe(mine);
  });

  test("copy not found => CopyNotFound", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, puzzleId } = await seed(t);
    // Insert then delete a copy to obtain a valid-but-missing id.
    const ghost = await addCopy(t, puzzleId, bob, { ...ALL_FALSE, forSale: true });
    await t.run(async (ctx) => ctx.db.delete(ghost));
    void alice;
    await expectConvexCode(
      asAlice(t).mutation(api.exchange.propose.propose, {
        recipientId: bob,
        type: "sale",
        requestedPuzzleId: ghost,
        salePrice: 1000,
      }),
      "CopyNotFound",
    );
  });

  test("dedups a second proposed request for the same copy", async () => {
    const t = convexTest(schema, modules);
    const { bob, puzzleId } = await seed(t);
    const copy = await addCopy(t, puzzleId, bob, { ...ALL_FALSE, forSale: true });
    await asAlice(t).mutation(api.exchange.propose.propose, {
      recipientId: bob,
      type: "sale",
      requestedPuzzleId: copy,
      salePrice: 1000,
    });
    await expectConvexCode(
      asAlice(t).mutation(api.exchange.propose.propose, {
        recipientId: bob,
        type: "sale",
        requestedPuzzleId: copy,
        salePrice: 1000,
      }),
      "DuplicateProposal",
    );
  });

  test("rejects a self-exchange (recipient resolves to the authed initiator)", async () => {
    const t = convexTest(schema, modules);
    const { alice, puzzleId } = await seed(t);
    const copy = await addCopy(t, puzzleId, alice, { ...ALL_FALSE, forSale: true });
    await expectConvexCode(
      asAlice(t).mutation(api.exchange.propose.propose, {
        recipientId: alice,
        type: "sale",
        requestedPuzzleId: copy,
        salePrice: 1000,
      }),
      "SelfExchange",
    );
  });

  test("creates a trade_request notification for the recipient", async () => {
    const t = convexTest(schema, modules);
    const { bob, puzzleId } = await seed(t);
    const copy = await addCopy(t, puzzleId, bob, { ...ALL_FALSE, forSale: true });
    const id = await asAlice(t).mutation(api.exchange.propose.propose, {
      recipientId: bob,
      type: "sale",
      requestedPuzzleId: copy,
      salePrice: 1000,
    });
    const notes = await notificationsFor(t, bob);
    expect(notes).toHaveLength(1);
    expect(notes[0].type).toBe("trade_request");
    expect(notes[0].title).toBe("New Exchange Request");
    const row = await exchangeRow(t, id);
    expect(notes[0].relatedId).toBe(row?._id);
  });
});

// Helper: Alice proposes a sale to Bob, returning the aggregateId.
const proposeSale = async (t: ReturnType<typeof convexTest>) => {
  const { alice, bob, puzzleId } = await seed(t);
  const copy = await addCopy(t, puzzleId, bob, { ...ALL_FALSE, forSale: true });
  const id = await asAlice(t).mutation(api.exchange.propose.propose, {
    recipientId: bob,
    type: "sale",
    requestedPuzzleId: copy,
    salePrice: 1000,
  });
  return { id, alice, bob, copy, puzzleId };
};

describe("exchange.accept / decline / cancel", () => {
  test("only the recipient may accept; wrong caller => WrongParty", async () => {
    const t = convexTest(schema, modules);
    const { id } = await proposeSale(t);
    await expectConvexCode(asAlice(t).mutation(api.exchange.accept.accept, { exchangeId: id }), "WrongParty");
    await asBob(t).mutation(api.exchange.accept.accept, { exchangeId: id });
    const row = await exchangeRow(t, id);
    expect(row?.status).toBe("accepted");
  });

  test("accepting notifies the initiator", async () => {
    const t = convexTest(schema, modules);
    const { id, alice } = await proposeSale(t);
    await asBob(t).mutation(api.exchange.accept.accept, { exchangeId: id });
    const notes = await notificationsFor(t, alice);
    expect(notes.map((n) => n.type)).toContain("trade_accepted");
  });

  test("only the recipient may decline", async () => {
    const t = convexTest(schema, modules);
    const { id, alice } = await proposeSale(t);
    await expectConvexCode(asAlice(t).mutation(api.exchange.decline.decline, { exchangeId: id }), "WrongParty");
    await asBob(t).mutation(api.exchange.decline.decline, { exchangeId: id });
    const row = await exchangeRow(t, id);
    expect(row?.status).toBe("rejected");
    const notes = await notificationsFor(t, alice);
    expect(notes.map((n) => n.type)).toContain("trade_declined");
  });

  test("only the initiator may cancel; recipient gets notified", async () => {
    const t = convexTest(schema, modules);
    const { id, bob } = await proposeSale(t);
    await expectConvexCode(asBob(t).mutation(api.exchange.cancel.cancel, { exchangeId: id }), "WrongParty");
    await asAlice(t).mutation(api.exchange.cancel.cancel, { exchangeId: id });
    const row = await exchangeRow(t, id);
    expect(row?.status).toBe("cancelled");
    const notes = await notificationsFor(t, bob);
    expect(notes.map((n) => n.type)).toContain("trade_cancelled");
  });

  test("illegal transition rejected (accept an already-cancelled exchange)", async () => {
    const t = convexTest(schema, modules);
    const { id } = await proposeSale(t);
    await asAlice(t).mutation(api.exchange.cancel.cancel, { exchangeId: id });
    await expectConvexCode(asBob(t).mutation(api.exchange.accept.accept, { exchangeId: id }), "IllegalTransition");
  });
});

describe("exchange.confirmCompletion", () => {
  test("one party confirming leaves status accepted with no availability change", async () => {
    const t = convexTest(schema, modules);
    const { id, copy } = await proposeSale(t);
    await asBob(t).mutation(api.exchange.accept.accept, { exchangeId: id });
    await asBob(t).mutation(api.exchange.confirmCompletion.confirmCompletion, { exchangeId: id });
    const row = await exchangeRow(t, id);
    expect(row?.status).toBe("accepted");
    const c = await getCopy(t, copy);
    expect(c?.availability.forSale).toBe(true); // still available
  });

  test("both confirming completes and flips the requested copy to all-false", async () => {
    const t = convexTest(schema, modules);
    const { id, alice, bob, copy } = await proposeSale(t);
    await asBob(t).mutation(api.exchange.accept.accept, { exchangeId: id });
    await asAlice(t).mutation(api.exchange.confirmCompletion.confirmCompletion, { exchangeId: id });
    await asBob(t).mutation(api.exchange.confirmCompletion.confirmCompletion, { exchangeId: id });
    const row = await exchangeRow(t, id);
    expect(row?.status).toBe("completed");
    const c = await getCopy(t, copy);
    expect(c?.availability).toEqual(ALL_FALSE);
    const aliceNotes = await notificationsFor(t, alice);
    const bobNotes = await notificationsFor(t, bob);
    expect(aliceNotes.map((n) => n.type)).toContain("trade_completed");
    expect(bobNotes.map((n) => n.type)).toContain("trade_completed");
  });

  test("a swap completion flips BOTH the requested and offered copies", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, puzzleId } = await seed(t);
    const requested = await addCopy(t, puzzleId, bob, { ...ALL_FALSE, forTrade: true });
    const offered = await addCopy(t, puzzleId, alice, { ...ALL_FALSE, forTrade: true });
    const id = await asAlice(t).mutation(api.exchange.propose.propose, {
      recipientId: bob,
      type: "trade",
      requestedPuzzleId: requested,
      offeredPuzzleId: offered,
    });
    await asBob(t).mutation(api.exchange.accept.accept, { exchangeId: id });
    await asAlice(t).mutation(api.exchange.confirmCompletion.confirmCompletion, { exchangeId: id });
    await asBob(t).mutation(api.exchange.confirmCompletion.confirmCompletion, { exchangeId: id });
    expect((await getCopy(t, requested))?.availability).toEqual(ALL_FALSE);
    expect((await getCopy(t, offered))?.availability).toEqual(ALL_FALSE);
  });
});

describe("exchange.raiseDispute", () => {
  test("can be raised from accepted", async () => {
    const t = convexTest(schema, modules);
    const { id } = await proposeSale(t);
    await asBob(t).mutation(api.exchange.accept.accept, { exchangeId: id });
    await asAlice(t).mutation(api.exchange.raiseDispute.raiseDispute, { exchangeId: id });
    expect((await exchangeRow(t, id))?.status).toBe("disputed");
  });

  test("can be raised from completed", async () => {
    const t = convexTest(schema, modules);
    const { id } = await proposeSale(t);
    await asBob(t).mutation(api.exchange.accept.accept, { exchangeId: id });
    await asAlice(t).mutation(api.exchange.confirmCompletion.confirmCompletion, { exchangeId: id });
    await asBob(t).mutation(api.exchange.confirmCompletion.confirmCompletion, { exchangeId: id });
    await asBob(t).mutation(api.exchange.raiseDispute.raiseDispute, { exchangeId: id });
    expect((await exchangeRow(t, id))?.status).toBe("disputed");
  });
});
