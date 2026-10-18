import presenceTest from "@convex-dev/presence/test";
import { Notification, toMemberId, toNotificationId } from "@jigswap/domain";
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  PUSH_THROTTLE_MS,
  pushChannel,
} from "./notifications/adapters/channels/pushChannel";
import { renderNotificationText } from "./notifications/copy";
import { DIGEST_COOLDOWN_MS } from "./notifications/threadDigest";
import { MESSAGES_ROOM } from "./presence";
import schema from "./schema";

// Circle thread and DM notifications (G5): the circle_message_received type, mute, per-thread
// in-app grouping, the push tag and throttle, and the delayed circle email digest. Every member's
// profile is PRIVATE and nobody follows anybody, so only the shared circle reveals one member to
// another.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;

const mkUser = (t: T, clerkId: string) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const id = await ctx.db.insert("users", {
      clerkId,
      email: `${clerkId}@example.com`,
      name: clerkId,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("profiles", {
      memberId: id,
      displayName: clerkId,
      visibility: "private",
      updatedAt: now,
    });
    return id;
  });

const as = (t: T, clerkId: string) => t.withIdentity({ subject: clerkId });

// Drain the async event dispatcher and the channels' scheduled sends.
const flush = async (t: T) => {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await t.finishInProgressScheduledFunctions();
  }
};

// A push subscription: push is only scheduled for a member who has one.
const subscribe = (t: T, userId: Id<"users">) =>
  t.run((ctx) =>
    ctx.db.insert("pushSubscriptions", {
      userId,
      endpoint: `https://push.example/${userId}`,
      p256dh: "p",
      auth: "a",
      createdAt: Date.now(),
    }),
  );

// Alice owns "Puzzle Club"; Bob and Carol are members; Dave is outside it. Everyone has push.
const seed = async (t: T) => {
  const alice = await mkUser(t, "alice");
  const bob = await mkUser(t, "bob");
  const carol = await mkUser(t, "carol");
  const dave = await mkUser(t, "dave");
  for (const member of [alice, bob, carol, dave]) await subscribe(t, member);
  const circleId = (await as(t, "alice").mutation(
    api.sharing.createCircle.createCircle,
    { name: "Puzzle Club" },
  )) as string;
  for (const memberId of [bob, carol]) {
    await as(t, "alice").mutation(internal.sharing.addMember.addMember, {
      circleId,
      memberId,
      permission: "ViewOnly",
    });
  }
  await flush(t);
  const threadId = (await as(t, "alice").mutation(
    api.conversation.openCircleThread.openCircleThread,
    { circleId },
  )) as string;
  return { alice, bob, carol, dave, circleId, threadId };
};

const post = async (t: T, clerkId: string, threadId: string, body: string) => {
  await as(t, clerkId).mutation(api.conversation.postMessage.postMessage, {
    threadId,
    kind: "text",
    body,
  });
  await flush(t);
};

// Circle-mates may open a DM with each other.
const openDm = (t: T, clerkId: string, recipientId: Id<"users">) =>
  as(t, clerkId).mutation(api.conversation.openDmThread.openDmThread, {
    recipientId,
  }) as Promise<string>;

const rowsOf = (t: T, userId: Id<"users">): Promise<Doc<"notifications">[]> =>
  t.run((ctx) =>
    ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .collect(),
  );

type Scheduled = { name: string; args: unknown[] };
const scheduled = (t: T, fragment: string): Promise<Scheduled[]> =>
  t.run(async (ctx) =>
    (
      (await ctx.db.system
        .query("_scheduled_functions")
        .collect()) as unknown as Scheduled[]
    ).filter((job) => job.name.includes(fragment)),
  );

// The push sends scheduled for one member.
const pushesTo = async (t: T, userId: Id<"users">) =>
  (await scheduled(t, "sendWebPush")).filter(
    (job) => (job.args[0] as { userId: string }).userId === userId,
  );

// The emails scheduled for one member.
const emailsTo = async (t: T, userId: Id<"users">) =>
  (await scheduled(t, "sendEmail")).filter(
    (job) => (job.args[0] as { userId?: string }).userId === userId,
  );

const mute = (t: T, clerkId: string, threadId: string) =>
  as(t, clerkId).mutation(api.conversation.setThreadMuted.setThreadMuted, {
    threadId,
    muted: true,
  });

const enableEmail = (t: T, clerkId: string, type: string) =>
  as(t, clerkId).mutation(
    api.notifications.updateNotificationPreference.updateNotificationPreference,
    { type: type as never, channel: "email", enabled: true },
  );

describe("circle_message_received", () => {
  test("a circle message notifies the other members with the circle type, in-app and push, never a per-message email", async () => {
    const t = convexTest(schema, modules);
    const { bob, carol, dave, threadId } = await seed(t);
    // Even with circle email switched on, a message is never emailed one by one.
    await enableEmail(t, "bob", "circle_message_received");
    await post(t, "alice", threadId, "hello club");

    for (const member of [bob, carol]) {
      const [row, ...rest] = await rowsOf(t, member);
      expect(rest).toEqual([]);
      expect(row).toMatchObject({
        type: "circle_message_received",
        subject: { kind: "thread", threadId },
      });
      expect(await pushesTo(t, member)).toHaveLength(1);
    }
    expect(await rowsOf(t, dave)).toEqual([]);
    const perMessage = (await emailsTo(t, bob)).filter(
      (job) =>
        (job.args[0] as { idempotencyKey: string }).idempotencyKey.startsWith(
          "digest:",
        ) === false,
    );
    expect(perMessage).toEqual([]);
  });

  test("a DM keeps message_received", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    const dm = await openDm(t, "alice", bob);
    await post(t, "alice", dm, "hi bob");
    const [row] = await rowsOf(t, bob);
    expect(row.type).toBe("message_received");
  });

  test("the circle type's email toggle goes through the real preference validator", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await enableEmail(t, "bob", "circle_message_received");
    const prefs = await as(t, "bob").query(
      api.notifications.getMyPreferences.getMyPreferences,
      {},
    );
    expect(prefs.circle_message_received).toEqual({
      inApp: true,
      email: true,
      push: true,
    });
    // DM email is untouched.
    expect(prefs.message_received.email).toBe(false);
  });
});

describe("mute", () => {
  test("a muted circle thread notifies the member on no channel; others still hear", async () => {
    const t = convexTest(schema, modules);
    const { bob, carol, threadId } = await seed(t);
    await enableEmail(t, "bob", "circle_message_received");
    await mute(t, "bob", threadId);
    await post(t, "alice", threadId, "one");
    await post(t, "carol", threadId, "two");

    expect(await rowsOf(t, bob)).toEqual([]);
    expect(await pushesTo(t, bob)).toEqual([]);
    expect(await emailsTo(t, bob)).toEqual([]);
    expect(await scheduled(t, "maybeEmailThreadDigest")).toEqual([]);
    expect(await rowsOf(t, carol)).toHaveLength(1);
  });

  test("a muted DM notifies on no channel", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    await enableEmail(t, "bob", "message_received");
    const dm = await openDm(t, "alice", bob);
    await mute(t, "bob", dm);
    await post(t, "alice", dm, "hi");
    expect(await rowsOf(t, bob)).toEqual([]);
    expect(await emailsTo(t, bob)).toEqual([]);
  });
});

const viewsOf = async (t: T, clerkId: string) =>
  (
    await as(t, clerkId).query(
      api.notifications.listMyNotificationViews.listMyNotificationViews,
      { paginationOpts: { numItems: 20, cursor: null } },
    )
  ).page;

describe("per-thread in-app grouping", () => {
  test("messages in one circle thread merge into one unread row: distinct authors newest first, counted once", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, carol, dave, circleId, threadId } = await seed(t);
    await as(t, "alice").mutation(internal.sharing.addMember.addMember, {
      circleId,
      memberId: dave,
      permission: "ViewOnly",
    });
    await flush(t);
    await post(t, "alice", threadId, "one");
    await post(t, "carol", threadId, "two");
    await post(t, "alice", threadId, "three");
    await post(t, "dave", threadId, "four");

    const [row, ...rest] = await rowsOf(t, bob);
    expect(rest).toEqual([]);
    expect(row).toMatchObject({
      type: "circle_message_received",
      groupKey: `thread:${threadId}`,
      actorIds: [dave, alice, carol],
      actorCount: 3,
      isRead: false,
    });

    // Bob sees every author named through the circle rule, and the circle's name.
    const [view] = await viewsOf(t, "bob");
    expect(view.actorCount).toBe(3);
    expect(view.actors.map((a) => !a.anonymous && a.memberId)).toEqual([
      dave,
      alice,
      carol,
    ]);
    expect(view.context.circleName).toBe("Puzzle Club");
    expect(view.href).toBe(`/messages/${threadId}`);
    // A grouped row offers no inline reply.
    expect(view.availableActions).toEqual([]);
  });

  test("a merge re-surfaces the thread's row above newer notifications; a read row opens a new group", async () => {
    const t = convexTest(schema, modules);
    const { bob, threadId } = await seed(t);
    await post(t, "alice", threadId, "one");
    const [first] = await rowsOf(t, bob);
    // Something else lands on top of it.
    await t.run((ctx) =>
      ctx.db.insert("notifications", {
        aggregateId: "other",
        userId: bob,
        type: "goal_achieved",
        isRead: false,
        createdAt: Date.now(),
      }),
    );
    await post(t, "carol", threadId, "two");
    let rows = await rowsOf(t, bob);
    expect(rows.map((r) => r.aggregateId)).toEqual([
      first.aggregateId,
      "other",
    ]);

    await as(t, "bob").mutation(
      api.notifications.markNotificationRead.markNotificationRead,
      { notificationId: first.aggregateId! },
    );
    await post(t, "alice", threadId, "three");
    rows = await rowsOf(t, bob);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ isRead: false, actorCount: 1 });
  });

  test("two threads never share a row", async () => {
    const t = convexTest(schema, modules);
    const { bob, threadId } = await seed(t);
    const dm = await openDm(t, "alice", bob);
    await post(t, "alice", threadId, "in the club");
    await post(t, "alice", dm, "just us");
    const rows = await rowsOf(t, bob);
    expect(rows.map((r) => r.groupKey).sort()).toEqual(
      [`thread:${dm}`, `thread:${threadId}`].sort(),
    );
  });

  test("DM messages group into one unread row per thread", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seed(t);
    const dm = await openDm(t, "alice", bob);
    await post(t, "alice", dm, "one");
    await post(t, "alice", dm, "two");
    await post(t, "alice", dm, "three");
    const [row, ...rest] = await rowsOf(t, bob);
    expect(rest).toEqual([]);
    expect(row).toMatchObject({
      type: "message_received",
      groupKey: `thread:${dm}`,
      actorIds: [alice],
      actorCount: 1,
    });
    // One actor: the reply action stays.
    const [view] = await viewsOf(t, "bob");
    expect(view.availableActions).toEqual(["reply_message"]);
  });
});

describe("author projection", () => {
  test("an author who is no longer a co-member, and not otherwise visible, stays anonymous", async () => {
    const t = convexTest(schema, modules);
    const { alice, threadId, circleId } = await seed(t);
    await post(t, "carol", threadId, "bye soon");
    await post(t, "alice", threadId, "ok");
    await as(t, "carol").mutation(api.sharing.leaveCircle.leaveCircle, {
      circleId,
    });
    await flush(t);
    const [view] = await viewsOf(t, "bob");
    expect(view.actorCount).toBe(2);
    expect(view.actors[0]).toMatchObject({ anonymous: false, memberId: alice });
    expect(view.actors[1]).toEqual({ anonymous: true });
    expect(JSON.stringify(view)).not.toContain("carol");
  });

  test("once the viewer has left, a co-member is no longer revealed by the circle", async () => {
    const t = convexTest(schema, modules);
    const { threadId, circleId } = await seed(t);
    await post(t, "carol", threadId, "hi");
    await as(t, "bob").mutation(api.sharing.leaveCircle.leaveCircle, {
      circleId,
    });
    await flush(t);
    const [view] = await viewsOf(t, "bob");
    expect(view.actors).toEqual([{ anonymous: true }]);
    expect(view.context.circleName).toBeUndefined();
    expect(view.href).toBe("/messages");
  });
});

describe("push throttle and tag", () => {
  // Push one circle message to `memberId` at an explicit time (the domain clock), straight through
  // the push channel.
  let seq = 0;
  const pushAt = (
    t: T,
    memberId: Id<"users">,
    actorId: Id<"users">,
    threadId: string,
    at: number,
  ) => {
    seq += 1;
    const notification = Notification.rehydrate({
      id: toNotificationId(`push-${seq}`),
      userId: toMemberId(memberId as unknown as string),
      type: "circle_message_received",
      params: {},
      relatedId: threadId,
      actorId: toMemberId(actorId as unknown as string),
      subject: { kind: "thread", threadId },
      channel: "push",
      isRead: false,
      createdAt: new Date(at),
    });
    return t.run((ctx) => pushChannel(ctx)(notification));
  };

  test("at most one push per thread per member per 2 minutes", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, carol, threadId } = await seed(t);
    const dm = await openDm(t, "alice", bob);
    const t0 = Date.now() + 60_000;
    await pushAt(t, bob, alice, threadId, t0);
    await pushAt(t, bob, carol, threadId, t0 + 1_000);
    await pushAt(t, bob, alice, threadId, t0 + PUSH_THROTTLE_MS - 1);
    // Another thread, and another member, have their own throttle.
    await pushAt(t, bob, alice, dm, t0 + 2_000);
    await pushAt(t, carol, alice, threadId, t0 + 3_000);
    expect(await pushesTo(t, bob)).toHaveLength(2);
    expect(await pushesTo(t, carol)).toHaveLength(1);

    // Once the window has passed, the next message pushes again.
    await pushAt(t, bob, alice, threadId, t0 + PUSH_THROTTLE_MS);
    expect(await pushesTo(t, bob)).toHaveLength(3);
    const seat = await t.run((ctx) =>
      ctx.db
        .query("threadParticipants")
        .withIndex("by_thread_member", (q) =>
          q.eq("threadAggregateId", threadId).eq("memberId", bob),
        )
        .unique(),
    );
    expect(seat?.lastPushedAt).toBe(t0 + PUSH_THROTTLE_MS);
  });

  test("a member without a push subscription gets no push job and no throttle write", async () => {
    const t = convexTest(schema, modules);
    const { bob, threadId } = await seed(t);
    await t.run(async (ctx) => {
      for (const row of await ctx.db
        .query("pushSubscriptions")
        .withIndex("by_user", (q) => q.eq("userId", bob))
        .collect()) {
        await ctx.db.delete(row._id);
      }
    });
    await post(t, "alice", threadId, "one");
    expect(await pushesTo(t, bob)).toEqual([]);
    const seat = await t.run((ctx) =>
      ctx.db
        .query("threadParticipants")
        .withIndex("by_thread_member", (q) =>
          q.eq("threadAggregateId", threadId).eq("memberId", bob),
        )
        .unique(),
    );
    expect(seat?.lastPushedAt).toBeUndefined();
    // The in-app row still lands.
    expect(await rowsOf(t, bob)).toHaveLength(1);
  });

  test("a burst of messages pushes once, and in-app still groups every one", async () => {
    const t = convexTest(schema, modules);
    const { bob, threadId } = await seed(t);
    await post(t, "alice", threadId, "one");
    await post(t, "carol", threadId, "two");
    await post(t, "alice", threadId, "three");
    const pushes = await pushesTo(t, bob);
    expect(pushes).toHaveLength(1);
    expect(pushes[0].args[0]).toMatchObject({
      type: "circle_message_received",
      subject: { kind: "thread", threadId },
    });
    const [row] = await rowsOf(t, bob);
    expect(row.actorCount).toBe(2);
  });
});

describe("circle push copy", () => {
  test("says who wrote where, never what", () => {
    expect(
      renderNotificationText("circle_message_received", {
        actorName: "Anna",
        circleName: "Puzzle Club",
        messagePreview: "secret plans",
      }),
    ).toEqual({
      title: "New messages in Puzzle Club",
      message: "Anna wrote in Puzzle Club",
    });
    expect(renderNotificationText("circle_message_received", {})).toEqual({
      title: "New messages",
      message: "New messages in your circle",
    });
  });
});

describe("circle email digest", () => {
  const seatOf = (t: T, threadId: string, memberId: Id<"users">) =>
    t.run((ctx) =>
      ctx.db
        .query("threadParticipants")
        .withIndex("by_thread_member", (q) =>
          q.eq("threadAggregateId", threadId).eq("memberId", memberId),
        )
        .unique(),
    );
  const fire = async (t: T, threadId: string, memberId: Id<"users">) => {
    await t.mutation(
      internal.notifications.threadDigest.maybeEmailThreadDigest,
      {
        threadId,
        memberId,
      },
    );
    await flush(t);
  };
  const digestsTo = async (t: T, memberId: Id<"users">) =>
    (await emailsTo(t, memberId)).filter((job) =>
      (job.args[0] as { idempotencyKey: string }).idempotencyKey.startsWith(
        "digest:",
      ),
    );
  const armed = async (t: T, memberId: Id<"users">) =>
    (await scheduled(t, "maybeEmailThreadDigest")).filter(
      (job) => (job.args[0] as { memberId: string }).memberId === memberId,
    );

  test("the first unread message arms one digest 30 minutes out; firing sends exactly one email", async () => {
    const t = convexTest(schema, modules);
    const { bob, carol, threadId } = await seed(t);
    await enableEmail(t, "bob", "circle_message_received");
    const before = Date.now();
    await post(t, "alice", threadId, "one");
    await post(t, "carol", threadId, "two");

    expect(await armed(t, bob)).toHaveLength(1);
    // Carol kept circle email off (the default): nothing is armed for her.
    expect(await armed(t, carol)).toEqual([]);
    const seat = await seatOf(t, threadId, bob);
    expect(seat?.emailPendingUntil).toBeGreaterThanOrEqual(
      before + 30 * 60 * 1000,
    );

    await fire(t, threadId, bob);
    const [digest, ...more] = await digestsTo(t, bob);
    expect(more).toEqual([]);
    expect(digest.args[0]).toMatchObject({
      type: "circle_message_received",
      relatedId: threadId,
      subject: { kind: "thread", threadId },
      params: {},
    });
    // The digest names no author.
    expect((digest.args[0] as { actorId?: string }).actorId).toBeUndefined();
    expect((await seatOf(t, threadId, bob))?.emailPendingUntil).toBeUndefined();

    // A duplicate fire, or more messages before Bob reads, send nothing more.
    await fire(t, threadId, bob);
    await post(t, "alice", threadId, "three");
    expect(await armed(t, bob)).toHaveLength(1);
    expect(await digestsTo(t, bob)).toHaveLength(1);
  });

  test("skipped when the member read the thread before it fired", async () => {
    const t = convexTest(schema, modules);
    const { bob, threadId } = await seed(t);
    await enableEmail(t, "bob", "circle_message_received");
    await post(t, "alice", threadId, "one");
    await as(t, "bob").mutation(
      api.conversation.markThreadRead.markThreadRead,
      {
        threadId,
      },
    );
    await fire(t, threadId, bob);
    expect(await digestsTo(t, bob)).toEqual([]);
  });

  test("skipped when the member muted the thread after it was armed", async () => {
    const t = convexTest(schema, modules);
    const { bob, threadId } = await seed(t);
    await enableEmail(t, "bob", "circle_message_received");
    await post(t, "alice", threadId, "one");
    await mute(t, "bob", threadId);
    await fire(t, threadId, bob);
    expect(await digestsTo(t, bob)).toEqual([]);
  });

  test("skipped when the member left the circle", async () => {
    const t = convexTest(schema, modules);
    const { bob, circleId, threadId } = await seed(t);
    await enableEmail(t, "bob", "circle_message_received");
    await post(t, "alice", threadId, "one");
    await as(t, "bob").mutation(api.sharing.leaveCircle.leaveCircle, {
      circleId,
    });
    await flush(t);
    await fire(t, threadId, bob);
    expect(await digestsTo(t, bob)).toEqual([]);
  });

  test("skipped when the member switched circle email off again", async () => {
    const t = convexTest(schema, modules);
    const { bob, threadId } = await seed(t);
    await enableEmail(t, "bob", "circle_message_received");
    await post(t, "alice", threadId, "one");
    await as(t, "bob").mutation(
      api.notifications.updateNotificationPreference
        .updateNotificationPreference,
      { type: "circle_message_received", channel: "email", enabled: false },
    );
    await fire(t, threadId, bob);
    expect(await digestsTo(t, bob)).toEqual([]);
  });

  test("skipped when the member is on /messages when it fires", async () => {
    const t = convexTest(schema, modules);
    presenceTest.register(t);
    const { bob, threadId } = await seed(t);
    await enableEmail(t, "bob", "circle_message_received");
    await post(t, "alice", threadId, "one");
    expect(await armed(t, bob)).toHaveLength(1);
    await as(t, "bob").mutation(api.presence.heartbeat, {
      roomId: MESSAGES_ROOM,
      userId: bob as string,
      sessionId: "session-bob",
      interval: 30_000,
    });
    await fire(t, threadId, bob);
    expect(await digestsTo(t, bob)).toEqual([]);
  });

  test("at most one digest per thread per 6 hours, even after a read", async () => {
    const t = convexTest(schema, modules);
    const { bob, threadId } = await seed(t);
    await enableEmail(t, "bob", "circle_message_received");
    const read = () =>
      as(t, "bob").mutation(api.conversation.markThreadRead.markThreadRead, {
        threadId,
      });
    await post(t, "alice", threadId, "one");
    await fire(t, threadId, bob);
    expect(await digestsTo(t, bob)).toHaveLength(1);

    // Bob reads; a new message inside the cooldown arms nothing, and a stray fire sends nothing.
    await read();
    await post(t, "alice", threadId, "two");
    expect(await armed(t, bob)).toHaveLength(1);
    await fire(t, threadId, bob);
    expect(await digestsTo(t, bob)).toHaveLength(1);

    // Six hours on (the stored clock moved back), the next unread message digests again.
    const seat = await seatOf(t, threadId, bob);
    await t.run((ctx) =>
      ctx.db.patch(seat!._id, {
        lastEmailedAt: Date.now() - DIGEST_COOLDOWN_MS - 1,
        lastReadAt: Date.now() - 1,
      }),
    );
    await post(t, "carol", threadId, "three");
    expect(await armed(t, bob)).toHaveLength(2);
    await fire(t, threadId, bob);
    expect(await digestsTo(t, bob)).toHaveLength(2);
  });

  test("DMs keep their per-message email and never arm a digest", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    await enableEmail(t, "bob", "message_received");
    const dm = await openDm(t, "alice", bob);
    await post(t, "alice", dm, "one");
    await post(t, "alice", dm, "two");
    const emails = await emailsTo(t, bob);
    expect(emails).toHaveLength(2);
    expect(await armed(t, bob)).toEqual([]);
  });
});

describe("the joinedAt floor", () => {
  test("a member who joined after a message was posted gets no notification of it on any channel", async () => {
    const t = convexTest(schema, modules);
    const { dave, threadId } = await seed(t);
    await as(t, "dave").mutation(
      api.notifications.updateNotificationPreference
        .updateNotificationPreference,
      { type: "circle_message_received", channel: "email", enabled: true },
    );
    await as(t, "alice").mutation(api.conversation.postMessage.postMessage, {
      threadId,
      kind: "text",
      body: "before dave",
    });
    // Dave lands in the thread (floor after the post) before the post's dispatch runs.
    await t.run(async (ctx) => {
      const thread = await ctx.db
        .query("threads")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", threadId))
        .unique();
      await ctx.db.patch(thread!._id, {
        participants: [...thread!.participants, dave],
      });
      await ctx.db.insert("threadParticipants", {
        threadAggregateId: threadId,
        memberId: dave,
        joinedAt: Date.now() + 1,
        unreadCount: 0,
      });
    });
    await flush(t);
    expect(await rowsOf(t, dave)).toEqual([]);
    expect(await pushesTo(t, dave)).toEqual([]);
    expect(await scheduled(t, "maybeEmailThreadDigest")).toEqual([]);
  });
});

describe("blocking: circle threads vs DMs", () => {
  const block = (t: T, blockerId: Id<"users">, blockedId: Id<"users">) =>
    t.run((ctx) =>
      ctx.db.insert("blocks", { blockerId, blockedId, createdAt: Date.now() }),
    );
  // Post, then land a block before the post's notification dispatch runs.
  const postThenBlock = async (
    t: T,
    clerkId: string,
    threadId: string,
    blockerId: Id<"users">,
    blockedId: Id<"users">,
  ) => {
    await as(t, clerkId).mutation(api.conversation.postMessage.postMessage, {
      threadId,
      kind: "text",
      body: "hi",
    });
    await block(t, blockerId, blockedId);
    await flush(t);
  };

  test("circle: the blocker's message still reaches the member they blocked, named, on every allowed channel", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, threadId } = await seed(t);
    await enableEmail(t, "bob", "circle_message_received");
    await postThenBlock(t, "alice", threadId, alice, bob);
    const [row] = await rowsOf(t, bob);
    expect(row).toMatchObject({
      type: "circle_message_received",
      actorIds: [alice],
    });
    expect(await pushesTo(t, bob)).toHaveLength(1);
    const [view] = await viewsOf(t, "bob");
    expect(view.actors[0]).toMatchObject({ anonymous: false, memberId: alice });
    expect(
      (await scheduled(t, "maybeEmailThreadDigest")).filter(
        (job) => (job.args[0] as { memberId: string }).memberId === bob,
      ),
    ).toHaveLength(1);
  });

  test("circle: the blocked member's message never reaches the blocker on any channel", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, carol, threadId } = await seed(t);
    await enableEmail(t, "alice", "circle_message_received");
    await postThenBlock(t, "bob", threadId, alice, bob);
    expect(await rowsOf(t, alice)).toEqual([]);
    expect(await pushesTo(t, alice)).toEqual([]);
    expect(await scheduled(t, "maybeEmailThreadDigest")).toEqual([]);
    // Carol, uninvolved, hears from Bob.
    expect(await rowsOf(t, carol)).toHaveLength(1);
  });

  test("DM: a block either way silences the message, whoever blocked", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seed(t);
    const dm = await openDm(t, "alice", bob);
    // Alice blocks Bob right after writing to him: Bob hears nothing.
    await postThenBlock(t, "alice", dm, alice, bob);
    expect(await rowsOf(t, bob)).toEqual([]);

    const t2 = convexTest(schema, modules);
    const s2 = await seed(t2);
    const dm2 = await openDm(t2, "alice", s2.bob);
    // Bob blocks Alice just as she writes: he hears nothing either.
    await postThenBlock(t2, "alice", dm2, s2.bob, s2.alice);
    expect(await rowsOf(t2, s2.bob)).toEqual([]);
  });
});
