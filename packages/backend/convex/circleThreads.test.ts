import { convexTest, type TestConvex } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  releaseEvidenceHold,
  settleSendBatch,
} from "./conversation/messageAttachments";
import { settleLocation } from "./conversation/sharedLocations";
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

describe("circle deletion", () => {
  const seedAttachment = (
    t: T,
    threadId: string,
    uploaderId: Id<"users">,
    extra: { evidenceHold?: boolean; quarantined?: boolean } = {},
  ) =>
    t.run(async (ctx) => {
      const now = Date.now();
      const fileId = await ctx.storage.store(new Blob(["x"]));
      return ctx.db.insert("messageAttachments", {
        kind: "image",
        threadAggregateId: threadId,
        uploaderId,
        fileId,
        byteSize: 1,
        contentType: "image/jpeg",
        moderationStatus: extra.quarantined ? "quarantined" : "approved",
        ...(extra.evidenceHold && { evidenceHold: true }),
        createdAt: now,
        updatedAt: now,
      });
    });

  test("deleting the circle purges its thread, messages, participant rows and attachments, keeping evidence-held and quarantined ones", async () => {
    const t = convexTest(schema, modules);
    const { bob, circleId } = await seed(t);
    const threadId = await open(t, "alice", circleId);
    await post(t, "alice", threadId, "hello");
    await post(t, "bob", threadId, "hi");
    const plain = await seedAttachment(t, threadId, bob);
    const held = await seedAttachment(t, threadId, bob, { evidenceHold: true });
    const quarantined = await seedAttachment(t, threadId, bob, {
      quarantined: true,
    });
    // Another circle's thread is untouched.
    const other = (await as(t, "bob").mutation(
      api.sharing.createCircle.createCircle,
      { name: "Other" },
    )) as string;
    const otherThread = await open(t, "bob", other);
    await post(t, "bob", otherThread, "still here");

    await as(t, "alice").mutation(api.sharing.deleteCircle.deleteCircle, {
      circleId,
      confirmName: "Puzzle Club",
    });
    await flush(t);

    await t.run(async (ctx) => {
      expect(
        await ctx.db
          .query("threads")
          .withIndex("by_circle", (q) => q.eq("circleId", circleId))
          .first(),
      ).toBeNull();
      expect(await ctx.db.get(plain)).toBeNull();
      const keptHeld = await ctx.db.get(held);
      expect(keptHeld?.evidenceHold).toBe(true);
      expect(
        keptHeld?.kind === "image" &&
          (await ctx.db.system.get(keptHeld.fileId)),
      ).toBeTruthy();
      expect(await ctx.db.get(quarantined)).not.toBeNull();
    });
    expect(await storedMessagesOf(t, threadId)).toHaveLength(0);
    expect(await participantRowsOf(t, threadId)).toHaveLength(0);
    expect(await storedMessagesOf(t, otherThread)).toHaveLength(1);
  });

  test("a thread larger than one batch is purged across batches", async () => {
    const t = convexTest(schema, modules);
    const { alice, circleId } = await seed(t);
    const threadId = await open(t, "alice", circleId);
    await t.run(async (ctx) => {
      for (let i = 0; i < 450; i++) {
        await ctx.db.insert("threadMessages", {
          threadAggregateId: threadId,
          messageId: `m-${i}`,
          authorId: alice,
          kind: "text",
          body: "x",
          sentAt: Date.now() + i,
        });
      }
    });
    await as(t, "alice").mutation(api.sharing.deleteCircle.deleteCircle, {
      circleId,
      confirmName: "Puzzle Club",
    });
    await flush(t);
    expect(await storedMessagesOf(t, threadId)).toHaveLength(0);
    expect(await participantRowsOf(t, threadId)).toHaveLength(0);
  });
});

// A member's floor (joinedAt) in the thread.
const floorOf = async (t: T, threadId: string, memberId: Id<"users">) => {
  const row = (await participantRowsOf(t, threadId)).find(
    (r) => r.memberId === memberId,
  );
  if (row?.joinedAt === undefined) throw new Error("no floor");
  return row.joinedAt;
};

const insertMessage = (
  t: T,
  threadId: string,
  authorId: Id<"users">,
  body: string,
  sentAt: number,
) =>
  t.run((ctx) =>
    ctx.db.insert("threadMessages", {
      threadAggregateId: threadId,
      messageId: crypto.randomUUID(),
      authorId,
      kind: "text",
      body,
      sentAt,
    }),
  );

const block = (t: T, blockerId: Id<"users">, blockedId: Id<"users">) =>
  t.run((ctx) =>
    ctx.db.insert("blocks", { blockerId, blockedId, createdAt: Date.now() }),
  );

const leave = async (t: T, clerkId: string, circleId: string) => {
  await as(t, clerkId).mutation(api.sharing.leaveCircle.leaveCircle, {
    circleId,
  });
  await flush(t);
};

describe("the joinedAt history floor", () => {
  test("a new member sees only messages sent strictly after they joined, plus their own 'joined' row", async () => {
    const t = convexTest(schema, modules);
    const { alice, dave, circleId } = await seed(t);
    const threadId = await open(t, "alice", circleId);
    await post(t, "alice", threadId, "before dave");
    await join(t, circleId, dave);
    await flush(t);
    const floor = await floorOf(t, threadId, dave);
    // Boundary: a row at exactly the floor is hidden, one a millisecond later is shown.
    await insertMessage(t, threadId, alice, "at the floor", floor);
    await insertMessage(t, threadId, alice, "just after", floor + 1);

    const daveSees = await messagesOf(t, "dave", threadId);
    expect(daveSees.map((m) => m.body)).toEqual([
      "member_joined",
      "just after",
    ]);
    expect(daveSees[0].systemEvent).toMatchObject({
      kind: "joined",
      member: { anonymous: false, member: { _id: dave } },
    });

    // Alice, a member since before, sees everything.
    expect((await messagesOf(t, "alice", threadId)).map((m) => m.body)).toEqual(
      [
        "before dave",
        // Same instant as the join row; the later insert sorts after it.
        "member_joined",
        "at the floor",
        "just after",
      ],
    );

    // The paginated read applies the same floor and exemption.
    const page = await as(t, "dave").query(
      api.conversation.listThreadMessages.listThreadMessages,
      { threadId, paginationOpts: { numItems: 10, cursor: null } },
    );
    expect(page.page.map((m) => m.body)).toEqual([
      "just after",
      "member_joined",
    ]);
  });

  test("the join-row exemption is only the viewer's own join row at their floor", async () => {
    const t = convexTest(schema, modules);
    const { alice, carol, dave, circleId } = await seed(t);
    const threadId = await open(t, "alice", circleId);
    await join(t, circleId, dave);
    await flush(t);
    const floor = await floorOf(t, threadId, dave);
    // Someone else's join row at dave's exact floor stays hidden from dave.
    await t.run((ctx) =>
      ctx.db.insert("threadMessages", {
        threadAggregateId: threadId,
        messageId: "other-join",
        kind: "system",
        body: "member_joined",
        sentAt: floor,
        systemEvent: { kind: "joined", memberId: carol },
      }),
    );
    void alice;
    const daveSees = await messagesOf(t, "dave", threadId);
    expect(daveSees).toHaveLength(1);
    expect(daveSees[0].systemEvent?.member).toMatchObject({
      member: { _id: dave },
    });
    // A "before" cursor at or below the floor yields nothing, not even the join row.
    expect(
      await as(t, "dave").query(
        api.conversation.getThreadMessages.getThreadMessages,
        { threadId, before: floor },
      ),
    ).toEqual([]);
  });

  test("a removed member loses the thread: reads are refused and it leaves their inbox", async () => {
    const t = convexTest(schema, modules);
    const { bob, circleId } = await seed(t);
    const threadId = await open(t, "alice", circleId);
    await post(t, "alice", threadId, "hello");
    expect((await inboxOf(t, "bob")).map((r) => r.threadId)).toEqual([
      threadId,
    ]);

    await as(t, "alice").mutation(api.sharing.removeMember.removeMember, {
      circleId,
      memberId: bob,
    });
    // Refused even before the async sync has run (the circle membership is already gone).
    await expectCode(messagesOf(t, "bob", threadId), "NotParticipant");
    expect(await inboxOf(t, "bob")).toEqual([]);
    await flush(t);
    await expectCode(messagesOf(t, "bob", threadId), "NotParticipant");
    await expectCode(
      as(t, "bob").query(
        api.conversation.listThreadMessages.listThreadMessages,
        {
          threadId,
          paginationOpts: { numItems: 10, cursor: null },
        },
      ),
      "NotParticipant",
    );
    expect(await inboxOf(t, "bob")).toEqual([]);
    expect(
      await as(t, "bob").query(
        api.conversation.getUnreadTotal.getUnreadTotal,
        {},
      ),
    ).toBe(0);
  });

  test("re-joining gives a fresh floor: what was said while away stays hidden", async () => {
    const t = convexTest(schema, modules);
    const { bob, circleId } = await seed(t);
    const threadId = await open(t, "alice", circleId);
    await post(t, "alice", threadId, "while bob was in");
    await leave(t, "bob", circleId);
    await post(t, "alice", threadId, "while bob was away");
    await join(t, circleId, bob);
    await flush(t);
    await post(t, "alice", threadId, "after bob came back");

    const bodies = (await messagesOf(t, "bob", threadId)).map((m) => m.body);
    expect(bodies).toEqual(["member_joined", "after bob came back"]);
  });
});

describe("join/leave rows and projection", () => {
  test("a co-member is named; a former member who isn't otherwise visible is 'a member'; the remover never appears", async () => {
    const t = convexTest(schema, modules);
    const { bob, carol, dave, circleId } = await seed(t);
    const threadId = await open(t, "alice", circleId);
    await join(t, circleId, dave);
    await flush(t);
    await post(t, "carol", threadId, "hi all");
    await as(t, "alice").mutation(api.sharing.removeMember.removeMember, {
      circleId,
      memberId: carol,
    });
    await flush(t);

    const bobSees = await messagesOf(t, "bob", threadId);
    const [joined, hi, left] = bobSees;
    // Dave is a current co-member: named.
    expect(joined.systemEvent).toMatchObject({
      kind: "joined",
      member: { anonymous: false, member: { _id: dave } },
    });
    // Carol has left and is private, not followed: her row says "a member", her message is anonymous.
    expect(left.systemEvent).toEqual({ kind: "left" });
    expect(hi.author).toMatchObject({ anonymous: true });
    expect(hi.isMine).toBe(false);
    // Nothing in the payload names who removed her.
    const json = JSON.stringify(bobSees);
    expect(json).not.toContain(carol);
    expect(json).not.toContain("alice");
    void bob;
  });

  test("a former member the viewer can see by the ordinary rules stays named", async () => {
    const t = convexTest(schema, modules);
    const { bob, carol, circleId } = await seed(t);
    const threadId = await open(t, "alice", circleId);
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("follows", {
        followerId: bob,
        followeeId: carol,
        createdAt: now,
      });
      await ctx.db.insert("follows", {
        followerId: carol,
        followeeId: bob,
        createdAt: now,
      });
    });
    await leave(t, "carol", circleId);
    const [left] = await messagesOf(t, "bob", threadId);
    expect(left.systemEvent).toMatchObject({
      kind: "left",
      member: { anonymous: false, member: { _id: carol } },
    });
  });

  test("authors carry `author`; the viewer's own messages keep isMine", async () => {
    const t = convexTest(schema, modules);
    const { alice, circleId } = await seed(t);
    const threadId = await open(t, "alice", circleId);
    await post(t, "alice", threadId, "mine");
    const [own] = await messagesOf(t, "alice", threadId);
    expect(own.isMine).toBe(true);
    expect(own.author).toMatchObject({ member: { _id: alice } });
    const [seenByBob] = await messagesOf(t, "bob", threadId);
    expect(seenByBob.isMine).toBe(false);
    expect(seenByBob.author).toMatchObject({
      anonymous: false,
      member: { _id: alice },
    });
  });
});

describe("blocking inside a circle", () => {
  test("the blocker sees the blocked member's messages flagged; the blocked member sees the blocker named and normal", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, circleId } = await seed(t);
    const threadId = await open(t, "alice", circleId);
    await block(t, alice, bob);
    // Neither side is refused posting in the circle thread.
    await post(t, "bob", threadId, "from bob");
    await post(t, "alice", threadId, "from alice");

    const aliceSees = await messagesOf(t, "alice", threadId);
    expect(aliceSees[0]).toMatchObject({
      body: "from bob",
      authorBlockedByMe: true,
    });
    expect(aliceSees[1].authorBlockedByMe).toBeUndefined();

    const bobSees = await messagesOf(t, "bob", threadId);
    expect(bobSees.every((m) => m.authorBlockedByMe === undefined)).toBe(true);
    // Alice blocked Bob, yet Bob still sees her named (the circle rule; the block stays silent).
    expect(bobSees[1].author).toMatchObject({
      anonymous: false,
      member: { _id: alice },
    });
    // Carol, uninvolved, sees both normally.
    const carolSees = await messagesOf(t, "carol", threadId);
    expect(carolSees.every((m) => m.authorBlockedByMe === undefined)).toBe(
      true,
    );
    // No block flags on the circle inbox row.
    const [row] = await inboxOf(t, "bob");
    expect(row.blocked).toBeUndefined();
    expect(row.readOnly).toBeUndefined();
  });

  test("a blocked author's messages are not unread for the blocker, nor notified to them", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, circleId } = await seed(t);
    const threadId = await open(t, "alice", circleId);
    await block(t, alice, bob);
    await post(t, "bob", threadId, "one");
    await post(t, "bob", threadId, "two");
    await flush(t);

    const unread = (clerkId: string) =>
      as(t, clerkId).query(api.conversation.getUnreadTotal.getUnreadTotal, {});
    expect(await unread("alice")).toBe(0);
    expect(await unread("carol")).toBe(2);
    const notified = await t.run((ctx) =>
      ctx.db
        .query("notifications")
        .withIndex("by_user", (q) => q.eq("userId", alice))
        .collect(),
    );
    expect(notified.filter((n) => n.type === "message_received")).toEqual([]);
  });
});

describe("inbox, unread and mute", () => {
  test("a circle thread appears in the inbox only once it has a message for the viewer, or they opened it", async () => {
    const t = convexTest(schema, modules);
    const { dave, circleId } = await seed(t);
    const threadId = await open(t, "alice", circleId);
    // Opened but empty: not listed for anyone yet (Alice never read it).
    expect(await inboxOf(t, "alice")).toEqual([]);
    // A join row alone doesn't list it either.
    await join(t, circleId, dave);
    await flush(t);
    expect(await inboxOf(t, "bob")).toEqual([]);
    // Reading it lists it for the reader.
    await as(t, "bob").mutation(
      api.conversation.markThreadRead.markThreadRead,
      {
        threadId,
      },
    );
    expect((await inboxOf(t, "bob")).map((r) => r.threadId)).toEqual([
      threadId,
    ]);
    expect(await inboxOf(t, "carol")).toEqual([]);
    // A message lists it for everyone.
    await post(t, "alice", threadId, "welcome");
    const [row] = await inboxOf(t, "carol");
    expect(row.subject).toMatchObject({
      kind: "circle",
      circleId,
      name: "Puzzle Club",
      memberCount: 4,
    });
    if (row.subject.kind !== "circle") throw new Error("unreachable");
    expect(row.subject.memberPreview).toHaveLength(3);
    expect(row.subject.memberPreview[0]).toMatchObject({ anonymous: false });
    expect(row.lastMessage).toMatchObject({ body: "welcome", isMine: false });
    expect(row.lastMessage?.author).toMatchObject({ anonymous: false });
    expect(row.unreadCount).toBe(1);
    expect(row.contextCopies).toEqual([]);
  });

  test("a new member never sees a pre-join snippet as the inbox's last message", async () => {
    const t = convexTest(schema, modules);
    const { alice, dave, circleId } = await seed(t);
    const threadId = await open(t, "alice", circleId);
    await post(t, "alice", threadId, "secret from before");
    await join(t, circleId, dave);
    await flush(t);
    // Force the stored summary back onto the pre-join message (as if posts raced the join row).
    const floor = await floorOf(t, threadId, dave);
    await t.run(async (ctx) => {
      const thread = await ctx.db
        .query("threads")
        .withIndex("by_circle", (q) => q.eq("circleId", circleId))
        .unique();
      await ctx.db.patch(thread!._id, {
        lastMessage: {
          messageId: "x",
          authorId: alice,
          kind: "text",
          body: "secret from before",
          sentAt: floor - 1,
        },
      });
    });
    await as(t, "dave").mutation(
      api.conversation.markThreadRead.markThreadRead,
      {
        threadId,
      },
    );
    const [row] = await inboxOf(t, "dave");
    expect(row.lastMessage).toBeNull();
    expect(JSON.stringify(row)).not.toContain("secret");
  });

  test("a muted thread is left out of the badge and flagged in the inbox; setThreadMuted touches only the caller's row", async () => {
    const t = convexTest(schema, modules);
    const { bob, carol, circleId } = await seed(t);
    const threadId = await open(t, "alice", circleId);
    await post(t, "alice", threadId, "one");
    const before = await participantRowsOf(t, threadId);

    await as(t, "bob").mutation(
      api.conversation.setThreadMuted.setThreadMuted,
      {
        threadId,
        muted: true,
      },
    );
    const after = await participantRowsOf(t, threadId);
    for (const row of after) {
      const was = before.find((b) => b._id === row._id)!;
      if (row.memberId === bob) expect(row).toEqual({ ...was, muted: true });
      else expect(row).toEqual(was);
    }
    expect(
      await as(t, "bob").query(
        api.conversation.getUnreadTotal.getUnreadTotal,
        {},
      ),
    ).toBe(0);
    const [row] = await inboxOf(t, "bob");
    expect(row).toMatchObject({ muted: true, unreadCount: 1 });
    expect(
      await as(t, "carol").query(
        api.conversation.getUnreadTotal.getUnreadTotal,
        {},
      ),
    ).toBe(1);

    await as(t, "bob").mutation(
      api.conversation.setThreadMuted.setThreadMuted,
      {
        threadId,
        muted: false,
      },
    );
    expect(
      await as(t, "bob").query(
        api.conversation.getUnreadTotal.getUnreadTotal,
        {},
      ),
    ).toBe(1);
    expect((await inboxOf(t, "bob"))[0].muted).toBeUndefined();
    void carol;
  });

  test("setThreadMuted is participants only", async () => {
    const t = convexTest(schema, modules);
    const { circleId } = await seed(t);
    const threadId = await open(t, "alice", circleId);
    await expectCode(
      as(t, "dave").mutation(api.conversation.setThreadMuted.setThreadMuted, {
        threadId,
        muted: true,
      }),
      "NotParticipant",
    );
    await expectCode(
      as(t, "dave").mutation(api.conversation.setThreadMuted.setThreadMuted, {
        threadId: "nope",
        muted: true,
      }),
      "ThreadNotFound",
    );
  });
});

describe("posting", () => {
  test("a removed member can't post, even before the sync has run", async () => {
    const t = convexTest(schema, modules);
    const { bob, circleId } = await seed(t);
    const threadId = await open(t, "alice", circleId);
    await as(t, "alice").mutation(api.sharing.removeMember.removeMember, {
      circleId,
      memberId: bob,
    });
    await expectCode(post(t, "bob", threadId, "still here?"), "NotParticipant");
    await flush(t);
    await expectCode(post(t, "bob", threadId, "still here?"), "NotParticipant");
    await expectCode(post(t, "dave", threadId, "hi"), "NotParticipant");
  });

  test("markThreadRead works for a circle thread and clears only the caller's unread", async () => {
    const t = convexTest(schema, modules);
    const { bob, carol, circleId } = await seed(t);
    const threadId = await open(t, "alice", circleId);
    await post(t, "alice", threadId, "one");
    await as(t, "bob").mutation(
      api.conversation.markThreadRead.markThreadRead,
      {
        threadId,
      },
    );
    const rows = await participantRowsOf(t, threadId);
    expect(rows.find((r) => r.memberId === bob)?.unreadCount).toBe(0);
    expect(rows.find((r) => r.memberId === carol)?.unreadCount).toBe(1);
  });

  test("the 50-member cap still holds for circles, so a circle thread never passes 50 participants", async () => {
    const t = convexTest(schema, modules);
    const { circleId } = await seed(t);
    // Alice, Bob and Carol hold 3 seats; fill to 50.
    for (let i = 0; i < 47; i++) {
      await join(t, circleId, await mkUser(t, `extra${i}`));
    }
    const late = await mkUser(t, "late");
    await expect(join(t, circleId, late)).rejects.toThrow();
    await flush(t);
    const threadId = await open(t, "alice", circleId);
    const thread = await t.run((ctx) =>
      ctx.db
        .query("threads")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", threadId))
        .unique(),
    );
    expect(thread!.participants).toHaveLength(50);
  });
});

describe("message notifications", () => {
  test("the blocker's messages still notify the member they blocked; never by email", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, circleId } = await seed(t);
    const threadId = await open(t, "alice", circleId);
    await block(t, alice, bob);
    // Bob opted in to message emails: a circle thread still sends him none.
    await as(t, "bob").mutation(
      api.notifications.updateNotificationPreference
        .updateNotificationPreference,
      { type: "message_received", channel: "email", enabled: true },
    );
    await post(t, "alice", threadId, "from alice");
    await post(t, "bob", threadId, "from bob");
    await flush(t);
    const messageRows = (userId: Id<"users">) =>
      t.run(async (ctx) =>
        (
          await ctx.db
            .query("notifications")
            .withIndex("by_user", (q) => q.eq("userId", userId))
            .collect()
        ).filter((n) => n.type === "message_received"),
      );
    // Bob (blocked) hears from Alice as before; Alice (the blocker) hears nothing from Bob.
    const toBob = await messageRows(bob);
    expect(toBob.length).toBeGreaterThan(0);
    expect(await messageRows(alice)).toEqual([]);
    // In-app and push only: no per-message email in a circle thread.
    expect(toBob.map((n) => n.channel ?? "inApp")).toContain("inApp");
    const emails = (
      await t.run((ctx) =>
        ctx.db.system.query("_scheduled_functions").collect(),
      )
    ).filter((job) => job.name.toLowerCase().includes("email"));
    expect(emails).toEqual([]);
  });

  test("an ex-member whose sync never ran is not notified", async () => {
    const t = convexTest(schema, modules);
    const { bob, carol, circleId } = await seed(t);
    const threadId = await open(t, "alice", circleId);
    // Bob loses his seat with no membership event (the thread still lists him).
    await t.run(async (ctx) => {
      const circle = await ctx.db
        .query("circles")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", circleId))
        .unique();
      await ctx.db.patch(circle!._id, {
        memberships: circle!.memberships.filter((m) => m.memberId !== bob),
      });
      const link = await ctx.db
        .query("circleMembers")
        .withIndex("by_circle_member", (q) =>
          q.eq("circleAggregateId", circleId).eq("memberId", bob),
        )
        .unique();
      await ctx.db.delete(link!._id);
    });
    await post(t, "alice", threadId, "hello");
    await flush(t);
    const count = (userId: Id<"users">) =>
      t.run(
        async (ctx) =>
          (
            await ctx.db
              .query("notifications")
              .withIndex("by_user", (q) => q.eq("userId", userId))
              .collect()
          ).filter((n) => n.type === "message_received").length,
      );
    expect(await count(bob)).toBe(0);
    expect(await count(carol)).toBeGreaterThan(0);
  });

  test("a circle notification never previews a message from a member the viewer blocked", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, circleId } = await seed(t);
    const threadId = await open(t, "alice", circleId);
    await block(t, alice, bob);
    await post(t, "carol", threadId, "from carol");
    await flush(t);
    await post(t, "bob", threadId, "bob secret");
    await flush(t);
    const views = await as(t, "alice").query(
      api.notifications.listMyNotificationViews.listMyNotificationViews,
      { paginationOpts: { numItems: 10, cursor: null } },
    );
    expect(views.page).toHaveLength(1);
    expect(JSON.stringify(views.page)).not.toContain("bob secret");
    // Carol, who blocked nobody, sees the newest message previewed.
    const carolViews = await as(t, "carol").query(
      api.notifications.listMyNotificationViews.listMyNotificationViews,
      { paginationOpts: { numItems: 10, cursor: null } },
    );
    expect(JSON.stringify(carolViews.page)).toContain("bob secret");
  });

  test("a member who joined after a message was posted is not notified about it", async () => {
    const t = convexTest(schema, modules);
    const { bob, dave, circleId } = await seed(t);
    const threadId = await open(t, "alice", circleId);
    await post(t, "alice", threadId, "before dave");
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
    const notified = (userId: Id<"users">) =>
      t.run(async (ctx) =>
        (
          await ctx.db
            .query("notifications")
            .withIndex("by_user", (q) => q.eq("userId", userId))
            .collect()
        ).filter((n) => n.type === "message_received"),
      );
    expect(await notified(dave)).toEqual([]);
    const [toBob] = await notified(bob);
    // No author name is snapshotted into a circle message notification.
    expect(toBob.params?.actorName).toBeUndefined();
  });
});

describe("account deletion", () => {
  test("a deleted member's circle participant rows go; their DM rows stay", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, circleId } = await seed(t);
    const threadId = await open(t, "alice", circleId);
    await post(t, "bob", threadId, "hello");
    const dmId = await t.run(async (ctx) => {
      const aggregateId = crypto.randomUUID();
      await ctx.db.insert("threads", {
        aggregateId,
        subjectKind: "dm",
        participants: [alice, bob],
        participantsKey: [alice, bob].sort().join("|"),
        createdAt: Date.now(),
      });
      for (const memberId of [alice, bob]) {
        await ctx.db.insert("threadParticipants", {
          threadAggregateId: aggregateId,
          memberId,
        });
      }
      return aggregateId;
    });

    await t.mutation(
      internal.conversation.purgeMemberMessagingData.purgeMemberMessagingData,
      { memberId: bob },
    );
    await flush(t);

    expect(
      (await participantRowsOf(t, threadId)).map((r) => r.memberId),
    ).not.toContain(bob);
    const thread = await t.run((ctx) =>
      ctx.db
        .query("threads")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", threadId))
        .unique(),
    );
    expect(thread!.participants).not.toContain(bob);
    expect((await participantRowsOf(t, dmId)).map((r) => r.memberId)).toContain(
      bob,
    );
    // Their message stays for the circle.
    expect((await messagesOf(t, "alice", threadId)).map((m) => m.body)).toEqual(
      ["hello"],
    );
  });
});

describe("reports", () => {
  test("a member can only report, and the evidence only holds, messages sent after they joined", async () => {
    const t = convexTest(schema, modules);
    const { dave, circleId } = await seed(t);
    const threadId = await open(t, "alice", circleId);
    const before = (await post(t, "alice", threadId, "before dave")) as string;
    await join(t, circleId, dave);
    await flush(t);
    const after = (await post(t, "alice", threadId, "after dave")) as string;

    const report = (targetId: string) =>
      as(t, "dave").mutation(api.reports.fileReport.fileReport, {
        targetKind: "message",
        targetId,
        reason: "harassment_hate",
      });
    await expectCode(report(before), "NotFound");
    const { reportId } = await report(after);
    const row = await t.run((ctx) => ctx.db.get(reportId));
    const evidence = JSON.stringify(row?.evidence);
    expect(evidence).toContain("after dave");
    expect(evidence).not.toContain("before dave");
  });
});

describe("media in circle threads", () => {
  const seedPhoto = (t: T, threadId: string, uploaderId: Id<"users">) =>
    t.run(async (ctx) => {
      const now = Date.now();
      return ctx.db.insert("messageAttachments", {
        kind: "image",
        threadAggregateId: threadId,
        uploaderId,
        fileId: await ctx.storage.store(new Blob(["x"])),
        byteSize: 1,
        contentType: "image/jpeg",
        moderationStatus: "approved",
        hashCheckedAt: now,
        reencodedAt: now,
        sendRequestedAt: now,
        sendIndex: 0,
        createdAt: now,
        updatedAt: now,
      });
    });
  const seedLocation = (t: T, threadId: string, uploaderId: Id<"users">) =>
    t.run(async (ctx) => {
      const now = Date.now();
      return ctx.db.insert("messageAttachments", {
        kind: "location",
        threadAggregateId: threadId,
        uploaderId,
        lat: 52.1,
        lng: 5.1,
        precision: "approximate",
        mapStatus: "pending",
        createdAt: now,
        updatedAt: now,
      });
    });

  test("a blocked member's photo and location reach the blocker and everyone else", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, circleId } = await seed(t);
    const threadId = await open(t, "alice", circleId);
    await block(t, alice, bob);
    const photo = await seedPhoto(t, threadId, bob);
    const place = await seedLocation(t, threadId, bob);
    await t.run(async (ctx) => {
      await settleSendBatch(ctx, photo);
      await settleLocation(ctx, place, undefined);
    });
    for (const viewer of ["alice", "carol"]) {
      const kinds = (await messagesOf(t, viewer, threadId)).map((m) => m.kind);
      expect(kinds).toEqual(["image", "location"]);
    }
  });

  test("Show on a photo: the uploader's block on the viewer is never told; the viewer's own block, a non-member and the floor refuse", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, dave, circleId } = await seed(t);
    const threadId = await open(t, "alice", circleId);
    const photo = await seedPhoto(t, threadId, alice);
    await t.run(async (ctx) => {
      await ctx.db.patch(photo, { moderationStatus: "blurred" });
      await settleSendBatch(ctx, photo);
    });
    const reveal = (clerkId: string) =>
      as(t, clerkId).mutation(
        api.conversation.revealMessageImage.revealMessageImage,
        { attachmentId: photo },
      );
    // Alice (the uploader) blocked Bob: Bob can still reveal it, as before the block.
    await block(t, alice, bob);
    await expect(reveal("bob")).resolves.toMatchObject({
      url: expect.any(String),
    });
    // Carol blocked Alice: it stays collapsed for Carol.
    const carol = (await t.run((ctx) =>
      ctx.db
        .query("users")
        .withIndex("by_clerk_id", (q) => q.eq("clerkId", "carol"))
        .unique(),
    ))!._id;
    await block(t, carol, alice);
    await expectCode(reveal("carol"), "AttachmentNotFound");
    // Dave is outside the circle, then joins after the photo: refused both times.
    await expectCode(reveal("dave"), "AttachmentNotFound");
    await join(t, circleId, dave);
    await flush(t);
    await expectCode(reveal("dave"), "AttachmentNotFound");
  });

  test("the shared attachment gate refuses a removed member before the sync has run", async () => {
    const t = convexTest(schema, modules);
    const { bob, circleId } = await seed(t);
    const threadId = await open(t, "alice", circleId);
    await as(t, "alice").mutation(api.sharing.removeMember.removeMember, {
      circleId,
      memberId: bob,
    });
    // Before the sync has run, the thread still lists Bob; the circle no longer does.
    await expectCode(
      as(t, "bob").query(
        api.conversation.listMyPendingAttachments.listMyPendingAttachments,
        { threadId },
      ),
      "NotParticipant",
    );
  });
});

describe("the floor fails closed", () => {
  test("a circle participant row without a joinedAt reads nothing", async () => {
    const t = convexTest(schema, modules);
    const { bob, circleId } = await seed(t);
    const threadId = await open(t, "alice", circleId);
    await post(t, "alice", threadId, "hello");
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("threadParticipants")
        .withIndex("by_thread_member", (q) =>
          q.eq("threadAggregateId", threadId).eq("memberId", bob),
        )
        .unique();
      await ctx.db.patch(row!._id, { joinedAt: undefined });
    });
    await expectCode(messagesOf(t, "bob", threadId), "NotParticipant");
    expect(await inboxOf(t, "bob")).toEqual([]);
  });

  test("the seat's newer join time wins over a stale participant row", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, circleId } = await seed(t);
    const threadId = await open(t, "alice", circleId);
    const old = await floorOf(t, threadId, bob);
    // The seat says Bob (re-)joined later than his row records, as after an unsynced re-join.
    await t.run(async (ctx) => {
      const circle = await ctx.db
        .query("circles")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", circleId))
        .unique();
      await ctx.db.patch(circle!._id, {
        memberships: circle!.memberships.map((m) =>
          m.memberId === bob ? { ...m, joinedAt: old + 1_000 } : m,
        ),
      });
    });
    await insertMessage(t, threadId, alice, "while away", old + 500);
    await insertMessage(t, threadId, alice, "after return", old + 1_500);
    expect((await messagesOf(t, "bob", threadId)).map((m) => m.body)).toEqual([
      "after return",
    ]);
  });
});

describe("re-join sync races", () => {
  test("a re-join whose 'left' never synced refreshes the row: fresh floor, 'left' then 'joined'", async () => {
    const t = convexTest(schema, modules);
    const { bob, circleId } = await seed(t);
    const threadId = await open(t, "alice", circleId);
    const old = await floorOf(t, threadId, bob);
    const rejoinedAt = old + 10_000;
    // Bob left and re-joined, but neither event has been mirrored into the thread yet.
    await t.run(async (ctx) => {
      const circle = await ctx.db
        .query("circles")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", circleId))
        .unique();
      await ctx.db.patch(circle!._id, {
        memberships: circle!.memberships.map((m) =>
          m.memberId === bob ? { ...m, joinedAt: rejoinedAt } : m,
        ),
      });
    });
    const dispatchEvent = async (name: string, occurredAt: number) => {
      const eventId = await t.run((ctx) =>
        ctx.db.insert("domainEvents", {
          name,
          payload: { circleId, memberId: bob, reason: "left" },
          occurredAt,
          context: "sharing",
        }),
      );
      await t.mutation(internal.events.dispatch.dispatch, { eventId });
      await flush(t);
    };
    // Out of order: the "joined" first, then the late "left".
    await dispatchEvent("MemberJoinedCircle", rejoinedAt);
    await dispatchEvent("MemberLeftCircle", old + 5_000);

    expect(await floorOf(t, threadId, bob)).toBe(rejoinedAt);
    const rows = (await storedMessagesOf(t, threadId)).map(
      (m) => m.systemEvent,
    );
    expect(rows).toEqual([
      { kind: "left", memberId: bob },
      { kind: "joined", memberId: bob },
    ]);
    // Run again in the other order: nothing changes.
    await dispatchEvent("MemberLeftCircle", old + 5_000);
    await dispatchEvent("MemberJoinedCircle", rejoinedAt);
    expect(await storedMessagesOf(t, threadId)).toHaveLength(2);
  });

  test("a deactivated member is never seeded into, or re-added to, the thread", async () => {
    const t = convexTest(schema, modules);
    const { carol, circleId } = await seed(t);
    await t.run((ctx) => ctx.db.patch(carol, { isActive: false }));
    const threadId = await open(t, "alice", circleId);
    expect(
      (await participantRowsOf(t, threadId)).map((r) => r.memberId),
    ).not.toContain(carol);
    const eventId = await t.run((ctx) =>
      ctx.db.insert("domainEvents", {
        name: "MemberJoinedCircle",
        payload: { circleId, memberId: carol },
        occurredAt: Date.now(),
        context: "sharing",
      }),
    );
    await t.mutation(internal.events.dispatch.dispatch, { eventId });
    await flush(t);
    expect(
      (await participantRowsOf(t, threadId)).map((r) => r.memberId),
    ).not.toContain(carol);
  });
});

describe("reports and evidence after deletion", () => {
  test("a current circle co-member can be reported; an outsider can't", async () => {
    const t = convexTest(schema, modules);
    const { alice, circleId } = await seed(t);
    void circleId;
    const reportAlice = (clerkId: string) =>
      as(t, clerkId).mutation(api.reports.fileReport.fileReport, {
        targetKind: "user",
        targetId: alice,
        reason: "harassment_hate",
      });
    await expect(reportAlice("carol")).resolves.toMatchObject({
      reportId: expect.any(String),
    });
    await expectCode(reportAlice("dave"), "NotFound");
  });

  test("releasing the hold on a deleted circle's kept attachment deletes it", async () => {
    const t = convexTest(schema, modules);
    const { bob, circleId } = await seed(t);
    const threadId = await open(t, "alice", circleId);
    const held = await t.run(async (ctx) => {
      const now = Date.now();
      return ctx.db.insert("messageAttachments", {
        kind: "image",
        threadAggregateId: threadId,
        uploaderId: bob,
        fileId: await ctx.storage.store(new Blob(["x"])),
        byteSize: 1,
        contentType: "image/jpeg",
        moderationStatus: "approved",
        evidenceHold: true,
        createdAt: now,
        updatedAt: now,
      });
    });
    await as(t, "alice").mutation(api.sharing.deleteCircle.deleteCircle, {
      circleId,
      confirmName: "Puzzle Club",
    });
    await flush(t);
    expect(await t.run((ctx) => ctx.db.get(held))).not.toBeNull();
    // No open report references it any more: the hold is released and the row goes.
    await t.run((ctx) => releaseEvidenceHold(ctx, held));
    expect(await t.run((ctx) => ctx.db.get(held))).toBeNull();
  });
});
