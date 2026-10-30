import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// The bounded unread badge (PERF-B6m, the read side of SEC-24): getUnreadTotal reads a member's
// unmuted threads with unread messages from by_member_unread and stops early, so it never grows
// with the number of threads a member holds (a flood of exchange proposals included).

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);
type T = TestConvex<typeof schema>;

const BASE = 1_700_000_000_000;

const asUser = (t: T, name: string) =>
  t.withIdentity({ subject: `clerk_${name}` });

// victim (the inbox owner), mallory (the flooder), alice and carol, and a for-sale copy of victim's
// that every seeded proposal requests.
const seedWorld = (t: T) =>
  t.run(async (ctx) => {
    const mkUser = (name: string) =>
      ctx.db.insert("users", {
        clerkId: `clerk_${name}`,
        email: `${name}@example.com`,
        name,
        isActive: true,
        createdAt: BASE,
        updatedAt: BASE,
      });
    const victim = await mkUser("victim");
    const mallory = await mkUser("mallory");
    const alice = await mkUser("alice");
    const carol = await mkUser("carol");
    const puzzleId = await ctx.db.insert("puzzles", {
      title: "Harbour at dusk",
      pieceCount: 1000,
      status: "approved",
      submittedBy: victim,
      createdAt: BASE,
      updatedAt: BASE,
    });
    const copyId = await ctx.db.insert("ownedPuzzles", {
      puzzleId,
      ownerId: victim,
      condition: "good",
      availability: { forTrade: false, forSale: true, forLend: false },
      createdAt: BASE,
      updatedAt: BASE,
    });
    return { victim, mallory, alice, carol, copyId };
  });

type World = Awaited<ReturnType<typeof seedWorld>>;

interface ThreadSpec {
  // Activity instant (the one message's sentAt).
  at: number;
  // Stored unread count on the victim's row; absent = a pre-backfill row (no unreadCount and no
  // lastActivityAt), whose count comes from the message scan.
  unread?: number;
  legacy?: boolean;
  muted?: boolean;
}

// Exchange threads between mallory (initiator) and the victim, each with one message from
// mallory, inserted directly (the flood bypasses the propose path's caps). Returns the thread
// aggregate ids in spec order.
const seedThreads = (t: T, world: World, specs: ThreadSpec[]) =>
  t.run(async (ctx) => {
    const ids: string[] = [];
    for (const [i, spec] of specs.entries()) {
      const aggregateId = `thread_${spec.at}_${i}`;
      const exchangeId = await ctx.db.insert("exchanges", {
        aggregateId: `exchange_${spec.at}_${i}`,
        initiatorId: world.mallory,
        recipientId: world.victim,
        type: "sale",
        requestedPuzzleId: world.copyId,
        status: "proposed",
        createdAt: spec.at,
        updatedAt: spec.at,
      });
      const participants = [world.mallory, world.victim];
      await ctx.db.insert("threads", {
        aggregateId,
        subjectKind: "exchange",
        exchangeId,
        participants,
        participantsKey: participants
          .map((id) => id as string)
          .sort()
          .join("|"),
        lastMessageAt: spec.at,
        lastMessage: {
          messageId: `${aggregateId}_m`,
          authorId: world.mallory,
          kind: "text",
          body: `hello ${i}`,
          sentAt: spec.at,
        },
        createdAt: spec.at,
      });
      await ctx.db.insert("threadMessages", {
        threadAggregateId: aggregateId,
        messageId: `${aggregateId}_m`,
        authorId: world.mallory,
        kind: "text",
        body: `hello ${i}`,
        sentAt: spec.at,
      });
      await ctx.db.insert("threadParticipants", {
        threadAggregateId: aggregateId,
        memberId: world.mallory,
        lastReadAt: spec.at,
        unreadCount: 0,
        lastActivityAt: spec.at,
      });
      await ctx.db.insert("threadParticipants", {
        threadAggregateId: aggregateId,
        memberId: world.victim,
        ...(spec.legacy
          ? {}
          : { unreadCount: spec.unread ?? 1, lastActivityAt: spec.at }),
        ...(spec.muted ? { muted: true } : {}),
      });
      ids.push(aggregateId);
    }
    return ids;
  });

const unreadOf = (t: T, name: string) =>
  asUser(t, name).query(api.conversation.getUnreadTotal.getUnreadTotal, {});

const specs = (count: number, from = BASE + 1_000): ThreadSpec[] =>
  Array.from({ length: count }, (_, i) => ({ at: from + i * 1_000 }));

describe("getUnreadTotal is bounded", () => {
  test("stops at 50 (the badge reads 50+) without reading every thread", async () => {
    const t = convexTest({
      schema,
      modules,
      transactionLimits: { documentsRead: 400 },
    });
    const world = await seedWorld(t);
    await seedThreads(t, world, specs(400));

    expect(await unreadOf(t, "victim")).toBe(50);
  });

  test("sums unmuted, listable threads, including rows from before the stored count", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    const ids = await seedThreads(t, world, [
      { at: BASE + 1_000, unread: 3 },
      { at: BASE + 2_000, unread: 0 },
      { at: BASE + 3_000, unread: 40, muted: true },
      { at: BASE + 4_000, legacy: true },
      { at: BASE + 5_000, legacy: true, muted: true },
      { at: BASE + 6_000, unread: 7 },
    ]);
    expect(await unreadOf(t, "victim")).toBe(3 + 1 + 7);

    // A thread whose exchange row is gone is out of the inbox, so out of the badge too.
    await t.run(async (ctx) => {
      const thread = await ctx.db
        .query("threads")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", ids[5]))
        .unique();
      if (thread?.exchangeId) await ctx.db.delete(thread.exchangeId);
    });
    expect(await unreadOf(t, "victim")).toBe(3 + 1);
  });

  test("more than 50 across threads reads as exactly 50", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    await seedThreads(t, world, [
      { at: BASE + 1_000, unread: 30 },
      { at: BASE + 2_000, unread: 30 },
      { at: BASE + 3_000, unread: 30 },
    ]);
    expect(await unreadOf(t, "victim")).toBe(50);
  });

  test("muted threads cost the badge nothing", async () => {
    const t = convexTest({
      schema,
      modules,
      transactionLimits: { documentsRead: 100 },
    });
    const world = await seedWorld(t);
    await seedThreads(t, world, [
      ...Array.from({ length: 300 }, (_, i) => ({
        at: BASE + 10_000 + i,
        unread: 50,
        muted: true,
      })),
      { at: BASE + 1_000, unread: 2 },
    ]);
    expect(await unreadOf(t, "victim")).toBe(2);
  });
});
