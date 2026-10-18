import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
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

// Alice owns "Puzzle Club"; Bob and Carol are members; Dave is outside it.
const seed = async (t: T) => {
  const alice = await mkUser(t, "alice");
  const bob = await mkUser(t, "bob");
  const carol = await mkUser(t, "carol");
  const dave = await mkUser(t, "dave");
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
