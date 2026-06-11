import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob("./**/!(*.test).*s");

type Avail = { forTrade: boolean; forSale: boolean; forLend: boolean };
const ALL_FALSE: Avail = { forTrade: false, forSale: false, forLend: false };

// Drain the async event dispatcher: yield a macrotask so the pending runAfter(0) job fires, then
// await any in-progress jobs — looped a few times to settle the chain.
const flushScheduled = async (t: ReturnType<typeof convexTest>) => {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await t.finishInProgressScheduledFunctions();
  }
};

const seed = (t: ReturnType<typeof convexTest>) =>
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
    return { alice, bob, puzzleId };
  });

const addCopy = (
  t: ReturnType<typeof convexTest>,
  puzzleId: Id<"puzzles">,
  ownerId: Id<"users">,
  availability: Avail,
) =>
  t.run(async (ctx) =>
    ctx.db.insert("ownedPuzzles", {
      puzzleId,
      ownerId,
      condition: "good",
      availability,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );

const notificationsFor = (
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
) =>
  t.run(async (ctx) =>
    ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect(),
  );

const asAlice = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice" });
const asBob = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_bob" });

// Alice proposes a sale to Bob; returns the exchange aggregateId + the seeded ids.
const proposeSale = async (t: ReturnType<typeof convexTest>) => {
  const { alice, bob, puzzleId } = await seed(t);
  const copy = await addCopy(t, puzzleId, bob, { ...ALL_FALSE, forSale: true });
  const id = await asAlice(t).mutation(api.exchange.propose.propose, {
    recipientId: bob,
    type: "sale",
    requestedPuzzleId: copy,
    salePrice: 1000,
  });
  return { id, alice, bob, copy };
};

describe("end-to-end async dispatch", () => {
  test("an emitted event is durably logged, dispatched, and lands a notification", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await proposeSale(t);

    // The event row is recorded synchronously with the proposing mutation.
    const eventsBefore = await t.run((ctx) =>
      ctx.db.query("domainEvents").collect(),
    );
    expect(eventsBefore.map((e) => e.name)).toContain("ExchangeProposed");

    // Before the dispatcher runs, no notification exists yet (it is async).
    expect(await notificationsFor(t, bob)).toHaveLength(0);

    await flushScheduled(t);

    const notes = await notificationsFor(t, bob);
    expect(notes).toHaveLength(1);
    expect(notes[0].type).toBe("trade_request");
    expect(notes[0].channel).toBe("inApp");
    expect(notes[0].aggregateId).toBeDefined();

    // The dispatched event row is stamped processed.
    const eventsAfter = await t.run((ctx) =>
      ctx.db.query("domainEvents").collect(),
    );
    const proposed = eventsAfter.find((e) => e.name === "ExchangeProposed");
    expect(proposed?.processedAt).toBeDefined();
  });

  test("calling the dispatcher directly on a recorded event creates the notification", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await proposeSale(t);
    await flushScheduled(t); // settle the auto-scheduled dispatch first

    // Re-insert a fresh (unprocessed) ExchangeProposed row and dispatch it directly.
    const exchange = await t.run((ctx) => ctx.db.query("exchanges").first());
    const eventId = await t.run((ctx) =>
      ctx.db.insert("domainEvents", {
        name: "ExchangeProposed",
        payload: { exchangeId: exchange?.aggregateId },
        occurredAt: Date.now(),
        context: "exchange",
      }),
    );
    await t.mutation(internal.events.dispatch.dispatch, { eventId });

    // Bob now has two trade_request notifications (auto + manual dispatch).
    const notes = await notificationsFor(t, bob);
    expect(notes.filter((n) => n.type === "trade_request")).toHaveLength(2);
    const event = await t.run((ctx) => ctx.db.get(eventId));
    expect(event?.processedAt).toBeDefined();
  });
});

describe("preference suppression", () => {
  test("disabling inApp for a type suppresses that notification", async () => {
    const t = convexTest(schema, modules);
    const { bob, puzzleId } = await seed(t);

    // Bob turns off in-app trade_request notifications.
    await asBob(t).mutation(
      api.notifications.updateNotificationPreference
        .updateNotificationPreference,
      {
        type: "trade_request",
        channel: "inApp",
        enabled: false,
      },
    );

    // Alice proposes; flush the dispatcher.
    const copy = await addCopy(t, puzzleId, bob, {
      ...ALL_FALSE,
      forSale: true,
    });
    await asAlice(t).mutation(api.exchange.propose.propose, {
      recipientId: bob,
      type: "sale",
      requestedPuzzleId: copy,
      salePrice: 1000,
    });
    await flushScheduled(t);

    // Suppressed: no notification was materialised.
    expect(await notificationsFor(t, bob)).toHaveLength(0);
  });
});

describe("read flows + queries", () => {
  test("markRead flips a single notification and unreadCount drops", async () => {
    const t = convexTest(schema, modules);
    await proposeSale(t);
    await flushScheduled(t);

    expect(
      await asBob(t).query(api.notifications.unreadCount.unreadCount, {}),
    ).toBe(1);

    const list = await asBob(t).query(
      api.notifications.listMyNotifications.listMyNotifications,
      {},
    );
    expect(list).toHaveLength(1);
    await asBob(t).mutation(
      api.notifications.markNotificationRead.markNotificationRead,
      {
        notificationId: list[0].aggregateId!,
      },
    );

    expect(
      await asBob(t).query(api.notifications.unreadCount.unreadCount, {}),
    ).toBe(0);
  });

  test("markAllRead clears every unread notification for the caller", async () => {
    const t = convexTest(schema, modules);
    const { id } = await proposeSale(t);
    // Cancelling also notifies the recipient (Bob), so Bob ends with two unread notifications.
    await asAlice(t).mutation(api.exchange.cancel.cancel, { exchangeId: id });
    await flushScheduled(t);

    const before = await asBob(t).query(
      api.notifications.unreadCount.unreadCount,
      {},
    );
    expect(before).toBe(2);

    await asBob(t).mutation(api.notifications.markAllRead.markAllRead, {});
    expect(
      await asBob(t).query(api.notifications.unreadCount.unreadCount, {}),
    ).toBe(0);
  });

  test("only the addressee may mark a notification read", async () => {
    const t = convexTest(schema, modules);
    await proposeSale(t);
    await flushScheduled(t);
    const list = await asBob(t).query(
      api.notifications.listMyNotifications.listMyNotifications,
      {},
    );

    // Alice (not the addressee) cannot mark Bob's notification read.
    await expect(
      asAlice(t).mutation(
        api.notifications.markNotificationRead.markNotificationRead,
        {
          notificationId: list[0].aggregateId!,
        },
      ),
    ).rejects.toThrow();
  });

  test("getMyPreferences returns sensible defaults when none stored", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const prefs = await asBob(t).query(
      api.notifications.getMyPreferences.getMyPreferences,
      {},
    );
    expect(prefs.trade_request.inApp).toBe(true);
    expect(prefs.trade_request.email).toBe(false);
  });
});

describe("backfill", () => {
  test("stamps aggregateId + channel on legacy notification rows, idempotently", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    // Insert a legacy notification with neither aggregateId nor channel.
    const legacy = await t.run((ctx) =>
      ctx.db.insert("notifications", {
        userId: bob,
        type: "trade_request",
        title: "Legacy",
        message: "Legacy notification",
        isRead: false,
        createdAt: Date.now(),
      }),
    );

    const first = await t.mutation(
      internal.notifications.backfill.backfillNotificationFields,
      {},
    );
    expect(first.patched).toBe(1);
    const row = await t.run((ctx) => ctx.db.get(legacy));
    expect(row?.aggregateId).toBeDefined();
    expect(row?.channel).toBe("inApp");

    // Idempotent: a second run patches nothing.
    const second = await t.mutation(
      internal.notifications.backfill.backfillNotificationFields,
      {},
    );
    expect(second.patched).toBe(0);
  });
});
