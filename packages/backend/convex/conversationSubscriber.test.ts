import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// Drain the async event dispatcher: yield a macrotask so the pending runAfter(0) job fires, then
// await any in-progress jobs — looped a few times to settle the chain (posting a system message
// records MessagePosted, which schedules its own dispatch).
const flushScheduled = async (t: ReturnType<typeof convexTest>) => {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await t.finishInProgressScheduledFunctions();
  }
};

// Seed the two parties plus a persisted exchange row between them (the subscriber resolves the
// exchange by its aggregateId to address the real parties). Fabricated directly — the subscriber
// reacts to recorded domainEvents rows, not to the proposing mutation.
const seed = (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (clerkId: string) =>
      ctx.db.insert("users", {
        clerkId,
        email: `${clerkId}@example.com`,
        name: clerkId,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const alice = await mkUser("clerk_alice");
    const bob = await mkUser("clerk_bob");
    const puzzleId = await ctx.db.insert("puzzles", {
      title: "Test Puzzle",
      pieceCount: 1000,
      status: "approved",
      submittedBy: alice,
      createdAt: now,
      updatedAt: now,
    });
    const copy = await ctx.db.insert("ownedPuzzles", {
      puzzleId,
      ownerId: bob,
      condition: "good",
      availability: { forTrade: false, forSale: true, forLend: false },
      createdAt: now,
      updatedAt: now,
    });
    const exchangeAggregateId = crypto.randomUUID();
    const exchangeDocId = await ctx.db.insert("exchanges", {
      aggregateId: exchangeAggregateId,
      initiatorId: alice,
      recipientId: bob,
      type: "sale",
      requestedPuzzleId: copy,
      salePrice: { amount: 1000, currency: "EUR" },
      status: "proposed",
      createdAt: now,
      updatedAt: now,
    });
    return { alice, bob, exchangeAggregateId, exchangeDocId };
  });

// Fabricate a recorded domainEvents row and dispatch it directly (the production path is the
// same internalMutation, scheduled by recordAndSchedule).
const dispatchEvent = async (
  t: ReturnType<typeof convexTest>,
  name: string,
  payload: Record<string, unknown>,
  context = "exchange",
) => {
  const eventId = await t.run((ctx) =>
    ctx.db.insert("domainEvents", {
      name,
      payload,
      occurredAt: Date.now(),
      context,
    }),
  );
  await t.mutation(internal.events.dispatch.dispatch, { eventId });
  await flushScheduled(t);
};

const threadsOf = (t: ReturnType<typeof convexTest>) =>
  t.run((ctx) => ctx.db.query("threads").collect());

const messagesOf = (
  t: ReturnType<typeof convexTest>,
  threadAggregateId: string,
) =>
  t.run((ctx) =>
    ctx.db
      .query("threadMessages")
      .withIndex("by_thread_sent", (q) =>
        q.eq("threadAggregateId", threadAggregateId),
      )
      .collect(),
  );

describe("conversation subscriber", () => {
  test("ExchangeProposed opens the exchange thread and posts the system message", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, exchangeAggregateId, exchangeDocId } = await seed(t);

    await dispatchEvent(t, "ExchangeProposed", {
      exchangeId: exchangeAggregateId,
    });

    const threads = await threadsOf(t);
    expect(threads).toHaveLength(1);
    expect(threads[0].subjectKind).toBe("exchange");
    expect(threads[0].exchangeId).toBe(exchangeDocId);
    expect(threads[0].participants).toEqual([alice, bob]);

    const messages = await messagesOf(t, threads[0].aggregateId);
    expect(messages).toHaveLength(1);
    expect(messages[0].kind).toBe("system");
    expect(messages[0].body).toBe("Exchange proposed");
    expect(messages[0].authorId).toBeUndefined();
  });

  test("re-dispatching lifecycle events for the same exchange never opens a second thread", async () => {
    const t = convexTest(schema, modules);
    const { exchangeAggregateId } = await seed(t);

    await dispatchEvent(t, "ExchangeProposed", {
      exchangeId: exchangeAggregateId,
    });
    // A second delivery (a fresh event row for the same exchange) lands on the existing thread.
    await dispatchEvent(t, "ExchangeProposed", {
      exchangeId: exchangeAggregateId,
    });
    await dispatchEvent(t, "ExchangeAccepted", {
      exchangeId: exchangeAggregateId,
    });

    expect(await threadsOf(t)).toHaveLength(1);
  });

  test.each([
    ["ExchangeAccepted", "Exchange accepted"],
    ["ExchangeRejected", "Exchange rejected"],
    ["ExchangeCancelled", "Exchange cancelled"],
    ["ExchangeCompleted", "Exchange completed"],
  ])(
    "%s appends the %j system message to the existing thread",
    async (name, body) => {
      const t = convexTest(schema, modules);
      const { exchangeAggregateId } = await seed(t);
      await dispatchEvent(t, "ExchangeProposed", {
        exchangeId: exchangeAggregateId,
      });

      await dispatchEvent(t, name, { exchangeId: exchangeAggregateId });

      const threads = await threadsOf(t);
      expect(threads).toHaveLength(1);
      const messages = await messagesOf(t, threads[0].aggregateId);
      expect(messages.map((m) => m.body)).toEqual(["Exchange proposed", body]);
      expect(messages[1].kind).toBe("system");
      expect(messages[1].authorId).toBeUndefined();
    },
  );

  test("a lifecycle event without a prior thread opens one (openThread is the safety net)", async () => {
    const t = convexTest(schema, modules);
    const { exchangeAggregateId } = await seed(t);

    await dispatchEvent(t, "ExchangeAccepted", {
      exchangeId: exchangeAggregateId,
    });

    const threads = await threadsOf(t);
    expect(threads).toHaveLength(1);
    const messages = await messagesOf(t, threads[0].aggregateId);
    expect(messages.map((m) => m.body)).toEqual(["Exchange accepted"]);
  });

  test("an unrelated event touches no threads and no messages", async () => {
    const t = convexTest(schema, modules);
    await seed(t);

    await dispatchEvent(
      t,
      "GoalAchieved",
      { goalId: "no-such-goal" },
      "solving",
    );

    expect(await threadsOf(t)).toHaveLength(0);
    expect(
      await t.run((ctx) => ctx.db.query("threadMessages").collect()),
    ).toHaveLength(0);
  });
});
