import { convexTest, type TestConvex } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// conversation/getCircleThreadId (G6b): which circle thread the circle page previews. Members
// only, with one generic CircleNotFound for everyone else; null (never a new thread) when the
// circle has no thread yet; and the preview read through getThreadMessages keeps the strict
// joinedAt floor and the block flag.

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

const join = (t: T, circleId: string, memberId: Id<"users">) =>
  as(t, "alice").mutation(internal.sharing.addMember.addMember, {
    circleId,
    memberId,
    permission: "ViewOnly",
  });

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

const threadIdOf = (t: T, clerkId: string, circleId: string) =>
  as(t, clerkId).query(api.conversation.getCircleThreadId.getCircleThreadId, {
    circleId,
  });

const open = (t: T, clerkId: string, circleId: string) =>
  as(t, clerkId).mutation(api.conversation.openCircleThread.openCircleThread, {
    circleId,
  }) as Promise<string>;

const preview = (t: T, clerkId: string, threadId: string) =>
  as(t, clerkId).query(api.conversation.getThreadMessages.getThreadMessages, {
    threadId,
    limit: 5,
  });

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

const joinedAtOf = (t: T, threadId: string, memberId: Id<"users">) =>
  t.run(async (ctx) => {
    const row = await ctx.db
      .query("threadParticipants")
      .withIndex("by_thread", (q) => q.eq("threadAggregateId", threadId))
      .filter((q) => q.eq(q.field("memberId"), memberId))
      .first();
    if (row?.joinedAt === undefined) throw new Error("no floor");
    return row.joinedAt;
  });

describe("getCircleThreadId", () => {
  test("null while the circle has no thread, and reading never creates one", async () => {
    const t = convexTest(schema, modules);
    const { circleId } = await seed(t);

    expect(await threadIdOf(t, "bob", circleId)).toBeNull();
    const threads = await t.run((ctx) =>
      ctx.db
        .query("threads")
        .withIndex("by_circle", (q) => q.eq("circleId", circleId))
        .collect(),
    );
    expect(threads).toEqual([]);
  });

  test("a member gets the circle's thread once it is opened", async () => {
    const t = convexTest(schema, modules);
    const { circleId } = await seed(t);
    const threadId = await open(t, "alice", circleId);

    expect(await threadIdOf(t, "bob", circleId)).toBe(threadId);
  });

  test("a non-member, an unknown circle and an ex-member all get the same CircleNotFound", async () => {
    const t = convexTest(schema, modules);
    const { bob, circleId } = await seed(t);
    await open(t, "alice", circleId);

    await expectCode(threadIdOf(t, "dave", circleId), "CircleNotFound");
    await expectCode(threadIdOf(t, "dave", "no-such-circle"), "CircleNotFound");

    await as(t, "alice").mutation(api.sharing.removeMember.removeMember, {
      circleId,
      memberId: bob,
    });
    await flush(t);
    await expectCode(threadIdOf(t, "bob", circleId), "CircleNotFound");
  });

  test("null for a seated member whose participant row hasn't synced yet", async () => {
    const t = convexTest(schema, modules);
    const { bob, circleId } = await seed(t);
    const threadId = await open(t, "alice", circleId);
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("threadParticipants")
        .withIndex("by_thread", (q) => q.eq("threadAggregateId", threadId))
        .filter((q) => q.eq(q.field("memberId"), bob))
        .first();
      if (row) await ctx.db.patch(row._id, { joinedAt: undefined });
    });

    expect(await threadIdOf(t, "bob", circleId)).toBeNull();
  });

  test("the preview keeps the strict joinedAt floor: a new member sees nothing from before they joined", async () => {
    const t = convexTest(schema, modules);
    const { alice, dave, circleId } = await seed(t);
    const threadId = await open(t, "alice", circleId);
    await join(t, circleId, dave);
    await flush(t);
    const floor = await joinedAtOf(t, threadId, dave);
    await insertMessage(t, threadId, alice, "before", floor - 1);
    await insertMessage(t, threadId, alice, "at the floor", floor);
    await insertMessage(t, threadId, alice, "after", floor + 1);

    const id = await threadIdOf(t, "dave", circleId);
    expect(id).toBe(threadId);
    const bodies = (await preview(t, "dave", threadId))
      .filter((m) => m.kind !== "system")
      .map((m) => m.body);
    expect(bodies).toEqual(["after"]);
    // Alice, there from the start, sees all three.
    const aliceBodies = (await preview(t, "alice", threadId))
      .filter((m) => m.kind !== "system")
      .map((m) => m.body);
    expect(aliceBodies).toEqual(["before", "at the floor", "after"]);
  });

  test("the preview flags a blocked author's messages for the blocker only", async () => {
    const t = convexTest(schema, modules);
    const { bob, carol, circleId } = await seed(t);
    const threadId = await open(t, "alice", circleId);
    await as(t, "carol").mutation(api.conversation.postMessage.postMessage, {
      threadId,
      kind: "text",
      body: "Who has the Wasgij?",
    });
    await t.run((ctx) =>
      ctx.db.insert("blocks", {
        blockerId: bob,
        blockedId: carol,
        createdAt: Date.now(),
      }),
    );

    const forBob = (await preview(t, "bob", threadId)).find(
      (m) => m.body === "Who has the Wasgij?",
    );
    expect(forBob?.authorBlockedByMe).toBe(true);
    const forAlice = (await preview(t, "alice", threadId)).find(
      (m) => m.body === "Who has the Wasgij?",
    );
    expect(forAlice?.authorBlockedByMe).toBeUndefined();
  });
});
