import {
  Notification,
  toMemberId,
  toNotificationId,
  type NotificationType,
} from "@jigswap/domain";
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { RATE_LIMITS } from "./lib/rateLimits";
import { emailChannel } from "./notifications/adapters/channels/emailChannel";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// SEC-25: a DM or exchange thread emails its recipient once per unread run (the first message after
// they last read the thread), not once per message, and no member is sent more than
// RATE_LIMITS.emailDaily.max notification emails a day.

type T = TestConvex<typeof schema>;

const tick = () => new Promise((resolve) => setTimeout(resolve, 3));

// Drain the async event dispatcher and the channels' scheduled sends.
const flush = async (t: T) => {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await t.finishInProgressScheduledFunctions();
  }
};

const seed = (t: T) =>
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
    // Mutual followers may open a DM with each other.
    await ctx.db.insert("follows", {
      followerId: alice,
      followeeId: bob,
      createdAt: now,
    });
    await ctx.db.insert("follows", {
      followerId: bob,
      followeeId: alice,
      createdAt: now,
    });
    return { alice, bob };
  });

const as = (t: T, clerkId: string) => t.withIdentity({ subject: clerkId });

type Scheduled = { name: string; args: unknown[] };
const emailsTo = (t: T, userId: Id<"users">, type: string) =>
  t.run(async (ctx) =>
    (
      (await ctx.db.system
        .query("_scheduled_functions")
        .collect()) as unknown as Scheduled[]
    ).filter((job) => {
      const args = job.args[0] as { userId?: string; type?: string };
      return (
        job.name.includes("sendEmail") &&
        args.userId === userId &&
        args.type === type
      );
    }),
  );

const post = (t: T, threadId: string, body: string) =>
  as(t, "clerk_alice").mutation(api.conversation.postMessage.postMessage, {
    threadId,
    kind: "text",
    body,
  });

// The sender's messagePost window, as if a minute had passed (the repro posts more than one
// window's worth).
const resetMessagePost = (t: T, alice: Id<"users">) =>
  t.run(async (ctx) => {
    const row = await ctx.db
      .query("rateLimits")
      .withIndex("by_key", (q) => q.eq("key", `messagePost:${alice}`))
      .unique();
    if (row) await ctx.db.delete(row._id);
  });

describe("message email per unread run", () => {
  test("a burst of DM messages emails the recipient once, and again only after they read the thread", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seed(t);
    await as(t, "clerk_bob").mutation(
      api.notifications.updateNotificationPreference
        .updateNotificationPreference,
      { type: "message_received", channel: "email", enabled: true },
    );
    const threadId = await as(t, "clerk_alice").mutation(
      api.conversation.openDmThread.openDmThread,
      { recipientId: bob },
    );

    // CONV-2: a full messagePost window of messages in a row.
    for (let i = 0; i < RATE_LIMITS.messagePost.max; i++) {
      await post(t, threadId, `spam ${i}`);
    }
    await flush(t);
    expect(await emailsTo(t, bob, "message_received")).toHaveLength(1);
    // Every message still reached the bell.
    const seat = await t.run((ctx) =>
      ctx.db
        .query("threadParticipants")
        .withIndex("by_thread_member", (q) =>
          q.eq("threadAggregateId", threadId).eq("memberId", bob),
        )
        .unique(),
    );
    expect(seat?.unreadCount).toBe(RATE_LIMITS.messagePost.max);

    // Bob reads the thread: the next unread run emails him again, once.
    await tick();
    await as(t, "clerk_bob").mutation(
      api.conversation.markThreadRead.markThreadRead,
      { threadId },
    );
    await tick();
    await resetMessagePost(t, alice);
    await post(t, threadId, "are you there?");
    await post(t, threadId, "hello?");
    await flush(t);
    expect(await emailsTo(t, bob, "message_received")).toHaveLength(2);
  });

  test("each participant's unread run is their own: a reply emails the other side", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seed(t);
    for (const clerkId of ["clerk_alice", "clerk_bob"]) {
      await as(t, clerkId).mutation(
        api.notifications.updateNotificationPreference
          .updateNotificationPreference,
        { type: "message_received", channel: "email", enabled: true },
      );
    }
    const threadId = await as(t, "clerk_alice").mutation(
      api.conversation.openDmThread.openDmThread,
      { recipientId: bob },
    );
    await post(t, threadId, "one");
    await post(t, threadId, "two");
    await flush(t);
    await as(t, "clerk_bob").mutation(
      api.conversation.postMessage.postMessage,
      { threadId, kind: "text", body: "reply" },
    );
    await flush(t);

    expect(await emailsTo(t, bob, "message_received")).toHaveLength(1);
    expect(await emailsTo(t, alice, "message_received")).toHaveLength(1);
  });
});

describe("daily email backstop", () => {
  // These tests only count the scheduled sends; keep them from running.
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  let seq = 0;
  const deliver = (
    t: T,
    recipient: Id<"users">,
    type: NotificationType = "trade_request",
  ) => {
    seq += 1;
    const notification = Notification.rehydrate({
      id: toNotificationId(`notif-${seq}`),
      userId: toMemberId(recipient as unknown as string),
      type,
      params: {},
      channel: "email",
      isRead: false,
      createdAt: new Date(),
    });
    return t.run((ctx) => emailChannel(ctx)(notification));
  };

  test("past the daily cap a member's emails are dropped, and other members still get theirs", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seed(t);
    const cap = RATE_LIMITS.emailDaily.max;

    for (let i = 0; i < cap + 1; i++) await deliver(t, bob);
    await deliver(t, alice);

    expect(await emailsTo(t, bob, "trade_request")).toHaveLength(cap);
    expect(await emailsTo(t, alice, "trade_request")).toHaveLength(1);
  });

  test("the cap is a daily window: a new day sends again", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    const cap = RATE_LIMITS.emailDaily.max;
    for (let i = 0; i < cap + 1; i++) await deliver(t, bob);

    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("rateLimits")
        .withIndex("by_key", (q) => q.eq("key", `emailDaily:${bob}`))
        .unique();
      if (!row) throw new Error("expected the emailDaily counter");
      await ctx.db.patch(row._id, {
        windowStart: row.windowStart - RATE_LIMITS.emailDaily.windowMs,
      });
    });
    await deliver(t, bob);

    expect(await emailsTo(t, bob, "trade_request")).toHaveLength(cap + 1);
  });
});
