import { convexTest, type TestConvex } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Circle group threads (G4): opening, membership sync, the joinedAt history floor, projection,
// blocking, unread and mute. Every member's profile is PRIVATE and nobody follows anybody, so
// the only thing that reveals one member to another is the shared circle.

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

// Drain the async event dispatcher (each sync posts a system message, which records
// MessagePosted and schedules its own dispatch).
const flush = async (t: T) => {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await t.finishInProgressScheduledFunctions();
  }
};

const dataOf = (e: unknown): { code?: string } => {
  const data = (e as ConvexError<Value>).data;
  return typeof data === "string"
    ? JSON.parse(data)
    : (data as { code?: string });
};

const expectCode = async (p: Promise<unknown>, code: string) => {
  const error = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ConvexError);
  expect(dataOf(error).code).toBe(code);
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
  for (const memberId of [bob, carol]) await join(t, circleId, memberId);
  await flush(t);
  return { alice, bob, carol, dave, circleId };
};

const join = (t: T, circleId: string, memberId: Id<"users">) =>
  as(t, "alice").mutation(internal.sharing.addMember.addMember, {
    circleId,
    memberId,
    permission: "ViewOnly",
  });

const open = (t: T, clerkId: string, circleId: string) =>
  as(t, clerkId).mutation(api.conversation.openCircleThread.openCircleThread, {
    circleId,
  }) as Promise<string>;

const post = (t: T, clerkId: string, threadId: string, body: string) =>
  as(t, clerkId).mutation(api.conversation.postMessage.postMessage, {
    threadId,
    kind: "text",
    body,
  });

const messagesOf = (t: T, clerkId: string, threadId: string) =>
  as(t, clerkId).query(api.conversation.getThreadMessages.getThreadMessages, {
    threadId,
  });

const inboxOf = (t: T, clerkId: string) =>
  as(t, clerkId).query(api.conversation.getMyInbox.getMyInbox, {});

const participantRowsOf = (t: T, threadId: string) =>
  t.run((ctx) =>
    ctx.db
      .query("threadParticipants")
      .withIndex("by_thread", (q) => q.eq("threadAggregateId", threadId))
      .collect(),
  );

const storedMessagesOf = (t: T, threadId: string) =>
  t.run((ctx) =>
    ctx.db
      .query("threadMessages")
      .withIndex("by_thread_sent", (q) => q.eq("threadAggregateId", threadId))
      .collect(),
  );

describe("openCircleThread", () => {
  test("a member opens the circle's one thread, seeded with every member; re-opening is idempotent", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, carol, circleId } = await seed(t);

    const threadId = await open(t, "bob", circleId);
    expect(await open(t, "alice", circleId)).toBe(threadId);
    expect(await open(t, "bob", circleId)).toBe(threadId);

    const threads = await t.run((ctx) =>
      ctx.db
        .query("threads")
        .withIndex("by_circle", (q) => q.eq("circleId", circleId))
        .collect(),
    );
    expect(threads).toHaveLength(1);
    expect(threads[0].subjectKind).toBe("circle");
    expect(new Set(threads[0].participants)).toEqual(
      new Set([alice, bob, carol]),
    );
    // Each member's floor is their seat's join time.
    const circle = await t.run((ctx) =>
      ctx.db
        .query("circles")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", circleId))
        .unique(),
    );
    const rows = await participantRowsOf(t, threadId);
    expect(
      Object.fromEntries(rows.map((r) => [r.memberId, r.joinedAt])),
    ).toEqual(
      Object.fromEntries(
        circle!.memberships.map((m) => [m.memberId, m.joinedAt]),
      ),
    );
  });

  test("a non-member, an ex-member and an unknown circle all get the same CircleNotFound", async () => {
    const t = convexTest(schema, modules);
    const { bob, circleId } = await seed(t);
    await expectCode(open(t, "dave", circleId), "CircleNotFound");
    await expectCode(open(t, "dave", "no-such-circle"), "CircleNotFound");

    await as(t, "alice").mutation(api.sharing.removeMember.removeMember, {
      circleId,
      memberId: bob,
    });
    await flush(t);
    await expectCode(open(t, "bob", circleId), "CircleNotFound");
  });
});

describe("circle membership sync", () => {
  test("a join adds the member with a 'joined' row; a leave and a removal drop their participant row with a 'left' row", async () => {
    const t = convexTest(schema, modules);
    const { bob, carol, dave, circleId } = await seed(t);
    const threadId = await open(t, "alice", circleId);

    await join(t, circleId, dave);
    await flush(t);
    let rows = await participantRowsOf(t, threadId);
    expect(rows.map((r) => r.memberId)).toContain(dave);

    await as(t, "bob").mutation(api.sharing.leaveCircle.leaveCircle, {
      circleId,
    });
    await as(t, "alice").mutation(api.sharing.removeMember.removeMember, {
      circleId,
      memberId: carol,
    });
    await flush(t);

    rows = await participantRowsOf(t, threadId);
    expect(rows.map((r) => r.memberId)).not.toContain(bob);
    expect(rows.map((r) => r.memberId)).not.toContain(carol);
    const thread = await t.run((ctx) =>
      ctx.db
        .query("threads")
        .withIndex("by_circle", (q) => q.eq("circleId", circleId))
        .unique(),
    );
    expect(thread!.participants).not.toContain(bob);

    const events = (await storedMessagesOf(t, threadId)).map(
      (m) => m.systemEvent,
    );
    expect(events).toEqual([
      { kind: "joined", memberId: dave },
      { kind: "left", memberId: bob },
      { kind: "left", memberId: carol },
    ]);
  });

  test("accepting an invite joins the circle's thread", async () => {
    const t = convexTest(schema, modules);
    const { alice, dave, circleId } = await seed(t);
    const threadId = await open(t, "alice", circleId);
    // Inviting needs a mutual follow (the contact gate).
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("follows", {
        followerId: alice,
        followeeId: dave,
        createdAt: now,
      });
      await ctx.db.insert("follows", {
        followerId: dave,
        followeeId: alice,
        createdAt: now,
      });
    });
    const inviteId = (await as(t, "alice").mutation(
      api.sharing.inviteToCircle.inviteToCircle,
      { circleId, inviteeId: dave, permission: "ViewOnly" },
    )) as string;
    await as(t, "dave").mutation(
      api.sharing.acceptCircleInvite.acceptCircleInvite,
      { inviteId },
    );
    await flush(t);
    expect(
      (await participantRowsOf(t, threadId)).map((r) => r.memberId),
    ).toContain(dave);
  });

  test("a stale or replayed membership event changes nothing", async () => {
    const t = convexTest(schema, modules);
    const { bob, circleId } = await seed(t);
    const threadId = await open(t, "alice", circleId);

    // Bob is a member: a replayed "left" for him must not drop him...
    const replay = async (name: string) => {
      const eventId = await t.run((ctx) =>
        ctx.db.insert("domainEvents", {
          name,
          payload: { circleId, memberId: bob, reason: "left" },
          occurredAt: Date.now(),
          context: "sharing",
        }),
      );
      await t.mutation(internal.events.dispatch.dispatch, { eventId });
      await flush(t);
    };
    await replay("MemberLeftCircle");
    expect(
      (await participantRowsOf(t, threadId)).map((r) => r.memberId),
    ).toContain(bob);
    // ...and a replayed "joined" for a current member posts no second row.
    await replay("MemberJoinedCircle");
    expect(await storedMessagesOf(t, threadId)).toHaveLength(0);

    // Once he left, a stale "joined" must not bring him back.
    await as(t, "bob").mutation(api.sharing.leaveCircle.leaveCircle, {
      circleId,
    });
    await flush(t);
    await replay("MemberJoinedCircle");
    expect(
      (await participantRowsOf(t, threadId)).map((r) => r.memberId),
    ).not.toContain(bob);
    expect(await storedMessagesOf(t, threadId)).toHaveLength(1);
  });

  test("no thread yet: membership changes create nothing", async () => {
    const t = convexTest(schema, modules);
    const { dave, circleId } = await seed(t);
    await join(t, circleId, dave);
    await flush(t);
    const threads = await t.run((ctx) =>
      ctx.db
        .query("threads")
        .withIndex("by_circle", (q) => q.eq("circleId", circleId))
        .collect(),
    );
    expect(threads).toHaveLength(0);
  });
});
