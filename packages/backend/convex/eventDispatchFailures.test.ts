import { convexTest, type TestConvex } from "convex-test";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
  type MockInstance,
} from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Every async subscriber the dispatcher calls is wrapped so a test can make it throw (a set number
// of times) and see which ones ran. The wrapper delegates to the real handler otherwise.
const control = vi.hoisted(() => {
  const fail = new Map<string, number>(); // handler -> remaining throws (before its real work)
  const failAfter = new Set<string>(); // handler -> does its real work (writes rows), THEN throws
  const calls: string[] = [];
  const wrap =
    (name: string, real: (...args: never[]) => Promise<void>) =>
    async (...args: never[]): Promise<void> => {
      calls.push(name);
      const remaining = fail.get(name) ?? 0;
      if (remaining > 0) {
        fail.set(name, remaining - 1);
        throw new Error(`${name} exploded`);
      }
      await real(...args);
      if (failAfter.has(name))
        throw new Error(`${name} exploded after writing`);
    };
  return { fail, failAfter, calls, wrap };
});

vi.mock("./exchange/tradeRevealSubscriber", async (orig) => {
  const real = await orig<typeof import("./exchange/tradeRevealSubscriber")>();
  return {
    ...real,
    handleDomainEvent: control.wrap("tradeReveal", real.handleDomainEvent),
  };
});
vi.mock("./notifications/subscriber", async (orig) => {
  const real = await orig<typeof import("./notifications/subscriber")>();
  return {
    ...real,
    handleDomainEvent: control.wrap("notifications", real.handleDomainEvent),
  };
});
vi.mock("./conversation/subscriber", async (orig) => {
  const real = await orig<typeof import("./conversation/subscriber")>();
  return {
    ...real,
    handleDomainEvent: control.wrap("conversation", real.handleDomainEvent),
  };
});
vi.mock("./custody/subscriber", async (orig) => {
  const real = await orig<typeof import("./custody/subscriber")>();
  return {
    ...real,
    handleDomainEvent: control.wrap("custody", real.handleDomainEvent),
  };
});
vi.mock("./library/transferOnSettlement", async (orig) => {
  const real = await orig<typeof import("./library/transferOnSettlement")>();
  return {
    ...real,
    handleDomainEvent: control.wrap("libraryTransfer", real.handleDomainEvent),
  };
});
vi.mock("./library/openLoanOnSettlement", async (orig) => {
  const real = await orig<typeof import("./library/openLoanOnSettlement")>();
  return {
    ...real,
    handleDomainEvent: control.wrap("openLoan", real.handleDomainEvent),
  };
});

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

let errorSpy: MockInstance<typeof console.error>;
beforeEach(() => {
  control.fail.clear();
  control.failAfter.clear();
  control.calls.length = 0;
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  errorSpy.mockRestore();
  // Restore real timers BEFORE the shared setup hook drains the macrotask queue with setTimeout(0).
  vi.useRealTimers();
});

// The structured dispatch-failure wide events written to the deployment log.
const dispatchErrorLines = (): Record<string, unknown>[] =>
  errorSpy.mock.calls
    .map((args) => {
      try {
        return JSON.parse(String(args[0])) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter(
      (line): line is Record<string, unknown> =>
        line !== null && line.event === "events.dispatch",
    );

// A real exchange between two members, so the notification + conversation handlers do real work.
const seedExchange = async (t: TestConvex<typeof schema>) => {
  const now = Date.now();
  return t.run(async (ctx) => {
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
    return { alice, bob, copy };
  });
};

const proposeSale = async (t: TestConvex<typeof schema>) => {
  const ids = await seedExchange(t);
  await t
    .withIdentity({ subject: "clerk_alice" })
    .mutation(api.exchange.propose.propose, {
      recipientId: ids.bob,
      type: "sale",
      requestedPuzzleId: ids.copy,
      salePrice: 1000,
    });
  // Settle the auto-scheduled dispatch of the proposal itself (no failures injected yet).
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await t.finishInProgressScheduledFunctions();
  }
  const exchange = await t.run((ctx) => ctx.db.query("exchanges").first());
  return { ...ids, exchangeAggregateId: exchange!.aggregateId! };
};

const recordEvent = (
  t: TestConvex<typeof schema>,
  name: string,
  payload: Record<string, unknown>,
) =>
  t.run((ctx) =>
    ctx.db.insert("domainEvents", {
      name,
      payload,
      occurredAt: Date.now(),
      context: "test",
    }),
  );

const notesFor = (
  t: TestConvex<typeof schema>,
  userId: Id<"users">,
  type: string,
) =>
  t.run(async (ctx) =>
    (
      await ctx.db
        .query("notifications")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect()
    ).filter((n) => n.type === type),
  );

const tradeRequestsFor = (t: TestConvex<typeof schema>, userId: Id<"users">) =>
  t.run(async (ctx) =>
    (
      await ctx.db
        .query("notifications")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect()
    ).filter((n) => n.type === "trade_request"),
  );

const systemMessages = (t: TestConvex<typeof schema>, body: string) =>
  t.run(async (ctx) =>
    (await ctx.db.query("threadMessages").collect()).filter(
      (m) => m.body === body,
    ),
  );

// Pending re-dispatches of ONE event (handlers may record + schedule events of their own).
const pendingDispatches = (
  t: TestConvex<typeof schema>,
  eventId: Id<"domainEvents">,
) =>
  t.run(async (ctx) =>
    (await ctx.db.system.query("_scheduled_functions").collect()).filter(
      (f) =>
        f.name.includes("events/dispatch") &&
        f.state.kind === "pending" &&
        (f.args[0] as { eventId?: string }).eventId === eventId,
    ),
  );

describe("dispatch failure visibility + retry policy", () => {
  test("a throwing idempotent handler is logged, retried with backoff up to the cap, then marked failed", async () => {
    const t = convexTest(schema, modules);
    const { alice, exchangeAggregateId } = await proposeSale(t);
    vi.useFakeTimers();
    control.fail.set("tradeReveal", Number.POSITIVE_INFINITY);

    const eventId = await recordEvent(t, "ExchangeAccepted", {
      exchangeId: exchangeAggregateId,
    });
    await t.mutation(internal.events.dispatch.dispatch, { eventId });

    // Attempt 1: the failure is a structured wide event, without the event payload.
    const first = dispatchErrorLines();
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      event: "events.dispatch",
      outcome: "error",
      event_id: eventId,
      event_name: "ExchangeAccepted",
      event_context: "test",
      handler: "tradeReveal",
      attempt: 1,
      max_attempts: 5,
      retryable: true,
      will_retry: true,
      error_message: "tradeReveal exploded",
    });
    expect(JSON.stringify(first[0])).not.toContain(exchangeAggregateId);

    // The other handlers' work committed despite the failure; the event is not processed and a
    // retry is scheduled.
    expect(await notesFor(t, alice, "trade_accepted")).toHaveLength(1);
    let event = await t.run((ctx) => ctx.db.get(eventId));
    expect(event?.processedAt).toBeUndefined();
    expect(event?.failedAt).toBeUndefined();
    expect(event?.attempts).toBe(1);
    expect(event?.lastError).toEqual({
      handler: "tradeReveal",
      message: "tradeReveal exploded",
    });
    const retries = await pendingDispatches(t, eventId);
    expect(retries).toHaveLength(1);
    expect(retries[0].scheduledTime - Date.now()).toBe(60_000); // first backoff step

    // Drive the backoff chain to the cap.
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // (The conversation's own MessagePosted event fails the same mocked handler; ignore it.)
    const lines = dispatchErrorLines().filter((l) => l.event_id === eventId);
    expect(lines.map((l) => l.attempt)).toEqual([1, 2, 3, 4, 5]);
    expect(lines.map((l) => l.will_retry)).toEqual([
      true,
      true,
      true,
      true,
      false,
    ]);
    event = await t.run((ctx) => ctx.db.get(eventId));
    expect(event?.attempts).toBe(5);
    expect(event?.failedAt).toBeDefined();
    expect(event?.processedAt).toBeUndefined();
    expect(event?.failedHandlers).toEqual(["tradeReveal"]);
    // Successful handlers ran exactly once — retries only re-run the failing one.
    expect(await notesFor(t, alice, "trade_accepted")).toHaveLength(1);
    expect(await systemMessages(t, "Exchange accepted")).toHaveLength(1);
  });

  test("a transient idempotent failure recovers on retry and the event is stamped processed", async () => {
    const t = convexTest(schema, modules);
    const { exchangeAggregateId } = await proposeSale(t);
    vi.useFakeTimers();
    control.fail.set("tradeReveal", 1);

    const eventId = await recordEvent(t, "ExchangeAccepted", {
      exchangeId: exchangeAggregateId,
    });
    await t.mutation(internal.events.dispatch.dispatch, { eventId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const event = await t.run((ctx) => ctx.db.get(eventId));
    expect(event?.processedAt).toBeDefined();
    expect(event?.failedAt).toBeUndefined();
    expect(event?.attempts).toBe(2);
    expect(dispatchErrorLines()).toHaveLength(1);
    // The reveal landed on the retry.
    const reveals = await t.run((ctx) =>
      ctx.db.query("tradeReveals").collect(),
    );
    expect(reveals).toHaveLength(1);
    expect(await systemMessages(t, "Exchange accepted")).toHaveLength(1);
  });

  test("a non-idempotent failure is logged and marked failed without a retry", async () => {
    const t = convexTest(schema, modules);
    const { bob, exchangeAggregateId } = await proposeSale(t);
    vi.useFakeTimers();
    control.fail.set("conversation", 1);

    const eventId = await recordEvent(t, "ExchangeProposed", {
      exchangeId: exchangeAggregateId,
    });
    await t.mutation(internal.events.dispatch.dispatch, { eventId });

    expect(await pendingDispatches(t, eventId)).toHaveLength(0);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const lines = dispatchErrorLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      handler: "conversation",
      attempt: 1,
      retryable: false,
      will_retry: false,
    });
    const event = await t.run((ctx) => ctx.db.get(eventId));
    expect(event?.attempts).toBe(1);
    expect(event?.failedAt).toBeDefined();
    expect(event?.processedAt).toBeUndefined();
    expect(event?.failedHandlers).toEqual(["conversation"]);
    expect(event?.lastError).toEqual({
      handler: "conversation",
      message: "conversation exploded",
    });
    // The failed handler's partial writes rolled back; the others committed.
    expect(await systemMessages(t, "Exchange proposed")).toHaveLength(1); // the auto one only
    expect(await tradeRequestsFor(t, bob)).toHaveLength(2);
  });

  test("custody and the library transfer commit together: a transfer throw after the custody write leaves no custody row", async () => {
    const t = convexTest(schema, modules);
    const { copy, alice, bob } = await seedExchange(t);
    control.fail.set("libraryTransfer", 1);

    const eventId = await recordEvent(t, "OwnershipTransferred", {
      copyId: copy,
      exchangeId: "x-1",
      newOwner: alice,
    });
    await t.mutation(internal.events.dispatch.dispatch, { eventId });

    // Custody really ran (and inserted) before the transfer threw; both rolled back together.
    expect(control.calls).toContain("custody");
    expect(control.calls).toContain("libraryTransfer");
    const custody = await t.run((ctx) =>
      ctx.db.query("copyCustodyEntries").collect(),
    );
    expect(custody).toHaveLength(0);
    expect((await t.run((ctx) => ctx.db.get(copy)))?.ownerId).toBe(bob);

    const event = await t.run((ctx) => ctx.db.get(eventId));
    expect(event?.failedAt).toBeDefined();
    expect(event?.failedHandlers).toEqual(["ownershipTransfer"]);
    // The other handler that reacts to every event still completed.
    expect(event?.completedHandlers).toEqual(["notifications"]);
    expect(dispatchErrorLines()[0]).toMatchObject({
      handler: "ownershipTransfer",
      retryable: false,
      will_retry: false,
    });
  });

  test("a handler that writes rows and then throws leaves none of them; the others' rows stay", async () => {
    const t = convexTest(schema, modules);
    const { bob, exchangeAggregateId } = await proposeSale(t);
    control.failAfter.add("notifications");

    const eventId = await recordEvent(t, "ExchangeProposed", {
      exchangeId: exchangeAggregateId,
    });
    await t.mutation(internal.events.dispatch.dispatch, { eventId });

    // The real notification handler inserted a trade_request, then threw: rolled back.
    expect(await tradeRequestsFor(t, bob)).toHaveLength(1); // the auto one only
    // Conversation's system message for this event committed.
    expect(await systemMessages(t, "Exchange proposed")).toHaveLength(2);
    const event = await t.run((ctx) => ctx.db.get(eventId));
    expect(event?.failedHandlers).toEqual(["notifications"]);
    expect(event?.lastError).toEqual({
      handler: "notifications",
      message: "notifications exploded after writing",
    });
  });

  test("a clean dispatch keeps the original row shape (processedAt only)", async () => {
    const t = convexTest(schema, modules);
    const eventId = await recordEvent(t, "SomethingUnrelated", {});
    await t.mutation(internal.events.dispatch.dispatch, { eventId });

    const event = await t.run((ctx) => ctx.db.get(eventId));
    expect(event?.processedAt).toBeDefined();
    expect(event?.attempts).toBeUndefined();
    expect(event?.failedAt).toBeUndefined();
    expect(dispatchErrorLines()).toHaveLength(0);
    // Only the handler without an event-name filter runs; the others open no sub-transaction.
    expect(control.calls).toEqual(["notifications"]);
  });

  test("a failed event is a no-op on re-dispatch", async () => {
    const t = convexTest(schema, modules);
    control.fail.set("notifications", 1);
    const eventId = await recordEvent(t, "SomethingUnrelated", {});
    await t.mutation(internal.events.dispatch.dispatch, { eventId });
    control.calls.length = 0;

    await t.mutation(internal.events.dispatch.dispatch, { eventId });
    expect(control.calls).toEqual([]);
  });
});
