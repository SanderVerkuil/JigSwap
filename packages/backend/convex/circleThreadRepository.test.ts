import {
  SYSTEM_EVENT_BODY,
  Thread,
  toCircleId,
  toMemberId,
  toMessageId,
  toThreadId,
  type MemberId,
} from "@jigswap/domain";
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { convexThreadRepository } from "./conversation/adapters/convexThreadRepository";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;

const seedMembers = (t: T) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mk = (clerkId: string) =>
      ctx.db.insert("users", {
        clerkId,
        email: `${clerkId}@example.com`,
        name: clerkId,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const ids = [await mk("a"), await mk("b"), await mk("c")];
    return ids.map((id) => toMemberId(id as string));
  });

const CIRCLE = toCircleId("circle-1");

const openCircle = (members: { memberId: MemberId; joinedAt: number }[]) => {
  const result = Thread.openForCircle(
    toThreadId(crypto.randomUUID()),
    CIRCLE,
    members.map((m) => ({
      memberId: m.memberId,
      joinedAt: new Date(m.joinedAt),
    })),
  );
  if (!result.isOk) throw new Error("openForCircle failed");
  return result.value;
};

const participantRows = (t: T, threadId: string) =>
  t.run((ctx) =>
    ctx.db
      .query("threadParticipants")
      .withIndex("by_thread", (q) => q.eq("threadAggregateId", threadId))
      .collect(),
  );

describe("convexThreadRepository: circle threads", () => {
  test("persists a circle thread keyed on the circle, with each member's joinedAt", async () => {
    const t = convexTest(schema, modules);
    const [a, b] = await seedMembers(t);
    const thread = openCircle([
      { memberId: a, joinedAt: 1_000 },
      { memberId: b, joinedAt: 2_000 },
    ]);
    await t.run((ctx) => convexThreadRepository(ctx).save(thread));

    const row = await t.run((ctx) =>
      ctx.db
        .query("threads")
        .withIndex("by_circle", (q) => q.eq("circleId", CIRCLE as string))
        .unique(),
    );
    expect(row?.subjectKind).toBe("circle");
    expect(row?.participantsKey).toBe("circle:circle-1");
    const rows = await participantRows(t, thread.id as string);
    expect(
      Object.fromEntries(rows.map((r) => [r.memberId as string, r.joinedAt])),
    ).toEqual({ [a as string]: 1_000, [b as string]: 2_000 });

    // findByCircle hydrates the subject and every member's floor.
    await t.run(async (ctx) => {
      const repo = convexThreadRepository(ctx);
      const found = await repo.findByCircle(CIRCLE);
      expect(found?.subject).toEqual({ kind: "circle", circleId: CIRCLE });
      expect(found?.visibleFrom(b)?.getTime()).toBe(2_000);
      expect(await repo.findByCircle(toCircleId("other"))).toBeNull();
    });
  });

  test("a join inserts the member's row with joinedAt; a leave deletes it; a re-join is a fresh row", async () => {
    const t = convexTest(schema, modules);
    const [a, b] = await seedMembers(t);
    const thread = openCircle([{ memberId: a, joinedAt: 1_000 }]);
    await t.run((ctx) => convexThreadRepository(ctx).save(thread));

    const step = (fn: (th: Thread) => void) =>
      t.run(async (ctx) => {
        const repo = convexThreadRepository(ctx);
        const loaded = await repo.findByCircle(CIRCLE);
        if (!loaded) throw new Error("missing");
        fn(loaded);
        await repo.save(loaded);
      });

    await step((th) => th.addParticipant(b, new Date(5_000)));
    let rows = await participantRows(t, thread.id as string);
    expect(rows.find((r) => r.memberId === (b as string))?.joinedAt).toBe(
      5_000,
    );

    await step((th) => th.removeParticipant(b, new Date(6_000)));
    rows = await participantRows(t, thread.id as string);
    expect(rows.map((r) => r.memberId as string)).toEqual([a as string]);

    await step((th) => th.addParticipant(b, new Date(9_000)));
    rows = await participantRows(t, thread.id as string);
    expect(rows.find((r) => r.memberId === (b as string))?.joinedAt).toBe(
      9_000,
    );
  });

  test("the systemEvent persists on the message and on the lastMessage summary", async () => {
    const t = convexTest(schema, modules);
    const [a, b] = await seedMembers(t);
    const thread = openCircle([{ memberId: a, joinedAt: 1_000 }]);
    thread.addParticipant(b, new Date(5_000));
    thread.postSystemMessage({
      id: toMessageId("m-join"),
      body: SYSTEM_EVENT_BODY.joined,
      sentAt: new Date(5_000),
      systemEvent: { kind: "joined", memberId: b },
    });
    await t.run((ctx) => convexThreadRepository(ctx).save(thread));

    const message = await t.run((ctx) =>
      ctx.db
        .query("threadMessages")
        .withIndex("by_message_id", (q) => q.eq("messageId", "m-join"))
        .unique(),
    );
    expect(message?.systemEvent).toEqual({ kind: "joined", memberId: b });
    const row = await t.run((ctx) =>
      ctx.db
        .query("threads")
        .withIndex("by_circle", (q) => q.eq("circleId", CIRCLE as string))
        .unique(),
    );
    expect(row?.lastMessage?.systemEvent).toEqual({
      kind: "joined",
      memberId: b,
    });
    // A join/leave row is unread for nobody, the joiner included.
    const rows = await participantRows(t, thread.id as string);
    expect(rows.map((r) => r.unreadCount)).toEqual([0, 0]);
  });

  test("a post is unread for every other member except one who blocked its author", async () => {
    const t = convexTest(schema, modules);
    const [a, b, c] = await seedMembers(t);
    await t.run((ctx) =>
      ctx.db.insert("blocks", {
        blockerId: c as unknown as never,
        blockedId: a as unknown as never,
        createdAt: Date.now(),
      }),
    );
    const thread = openCircle([
      { memberId: a, joinedAt: 1_000 },
      { memberId: b, joinedAt: 1_000 },
      { memberId: c, joinedAt: 1_000 },
    ]);
    thread.postMessage({
      id: toMessageId(crypto.randomUUID()),
      authorId: a,
      kind: "text",
      body: "hi",
      sentAt: new Date(2_000),
    });
    await t.run((ctx) => convexThreadRepository(ctx).save(thread));
    const rows = await participantRows(t, thread.id as string);
    const unread = Object.fromEntries(
      rows.map((r) => [r.memberId as string, r.unreadCount]),
    );
    expect(unread).toEqual({
      [a as string]: 0,
      [b as string]: 1,
      [c as string]: 0,
    });
  });
});
