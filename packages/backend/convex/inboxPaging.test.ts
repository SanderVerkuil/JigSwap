import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// Inbox paging and the bounded unread badge (PERF-B6m, the read side of SEC-24): getMyInbox and
// getUnreadTotal read a member's threads newest-first from their threadParticipants indexes and
// stop early, so neither grows with the number of threads a member holds (a flood of exchange
// proposals included). getInboxThread serves the open thread's header wherever it sits.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);
type T = TestConvex<typeof schema>;

beforeEach(() => {
  // getMyInbox warns about dropped (corrupt) exchange threads; keep the run quiet.
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

const BASE = 1_700_000_000_000;

const asUser = (t: T, name: string) =>
  t.withIdentity({ subject: `clerk_${name}` });

// victim (the inbox owner), mallory (the flooder), alice (a real counterparty), carol (outsider),
// and a for-sale copy of victim's that every seeded proposal requests.
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
    // A second copy for the one real proposal, so no seeded proposal stands in its way.
    const liveCopyId = await ctx.db.insert("ownedPuzzles", {
      puzzleId,
      ownerId: victim,
      condition: "good",
      availability: { forTrade: false, forSale: true, forLend: false },
      createdAt: BASE,
      updatedAt: BASE,
    });
    return { victim, mallory, alice, carol, copyId, liveCopyId };
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
        // A copy reference, so each row also pays for its context-copy probe.
        copyId: world.copyId,
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

const inboxOf = (t: T, name: string, args: { limit?: number } = {}) =>
  asUser(t, name).query(api.conversation.getMyInbox.getMyInbox, args);
const unreadOf = (t: T, name: string) =>
  asUser(t, name).query(api.conversation.getUnreadTotal.getUnreadTotal, {});
const headerOf = (t: T, name: string, threadId: string) =>
  asUser(t, name).query(api.conversation.getInboxThread.getInboxThread, {
    threadId,
  });

const specs = (count: number, from = BASE + 1_000): ThreadSpec[] =>
  Array.from({ length: count }, (_, i) => ({ at: from + i * 1_000 }));

// Proposes a real exchange (alice -> victim) so the live write path (thread repository, participant
// rows) is covered next to the seeded rows, and waits for the dispatcher to post its system row.
const proposeForReal = async (t: T, world: World) => {
  await asUser(t, "alice").mutation(api.exchange.propose.propose, {
    recipientId: world.victim,
    type: "sale",
    requestedPuzzleId: world.liveCopyId,
    salePrice: 1000,
  });
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await t.finishInProgressScheduledFunctions();
  }
  return t.run(async (ctx) => {
    const thread = (await ctx.db.query("threads").collect()).find((row) =>
      row.participants.includes(world.alice),
    );
    if (!thread) throw new Error("expected the proposal's thread");
    return thread.aggregateId;
  });
};

describe("getMyInbox pages by activity", () => {
  test("the default window is the newest 30 threads; a larger limit shows older ones", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    const seeded = await seedThreads(t, world, specs(60));
    const live = await proposeForReal(t, world);
    const newestFirst = [live, ...[...seeded].reverse()];

    const page = await inboxOf(t, "victim");
    expect(page.map((row) => row.threadId)).toEqual(newestFirst.slice(0, 30));

    const all = await inboxOf(t, "victim", { limit: 61 });
    expect(all.map((row) => row.threadId)).toEqual(newestFirst);
    // The proposal's thread renders like any other row.
    expect(all[0].subject.kind).toBe("exchange");
    expect(all[0].unreadCount).toBe(1);
  });

  test("limit is clamped to 1..100", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    await seedThreads(t, world, specs(105));

    expect(await inboxOf(t, "victim", { limit: 0 })).toHaveLength(1);
    expect(await inboxOf(t, "victim", { limit: -5 })).toHaveLength(1);
    expect(await inboxOf(t, "victim", { limit: 2.5 })).toHaveLength(2);
    expect(await inboxOf(t, "victim", { limit: 10_000 })).toHaveLength(100);
    expect(await inboxOf(t, "victim", { limit: Number.NaN })).toHaveLength(30);
  });

  test("rows written before lastActivityAt existed are merged in by thread activity", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    const ids = await seedThreads(t, world, [
      { at: BASE + 1_000 },
      { at: BASE + 2_000, legacy: true },
      { at: BASE + 3_000 },
      { at: BASE + 4_000, legacy: true },
      { at: BASE + 5_000 },
    ]);

    const inbox = await inboxOf(t, "victim");
    expect(inbox.map((row) => row.threadId)).toEqual([...ids].reverse());
    // A legacy row's unread count comes from the message scan.
    expect(inbox.map((row) => row.unreadCount)).toEqual([1, 1, 1, 1, 1]);
    expect(
      (await inboxOf(t, "victim", { limit: 2 })).map((row) => row.threadId),
    ).toEqual([ids[4], ids[3]]);
  });

  test("threads that no longer render are skipped without shortening the page", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    const ids = await seedThreads(t, world, specs(40));
    // The five newest lose their exchange row (their subject no longer resolves).
    await t.run(async (ctx) => {
      for (const id of ids.slice(-5)) {
        const thread = await ctx.db
          .query("threads")
          .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", id))
          .unique();
        if (thread?.exchangeId) await ctx.db.delete(thread.exchangeId);
      }
    });

    const page = await inboxOf(t, "victim");
    expect(page.map((row) => row.threadId)).toEqual(
      ids.slice(0, 35).reverse().slice(0, 30),
    );
  });

  test("a flood of threads does not grow the read", async () => {
    const t = convexTest({
      schema,
      modules,
      transactionLimits: { documentsRead: 1_000 },
    });
    const world = await seedWorld(t);
    await seedThreads(t, world, specs(400));

    expect(await inboxOf(t, "victim")).toHaveLength(30);
  });

  test("the largest page uses at most half of Convex's 4,096 queries per function", async () => {
    // About 18 queries per row here (one copy reference each); 200 rows came to ~3,500, too close
    // to the limit once threads reference a few copies, hence the cap of 100.
    const t = convexTest({
      schema,
      modules,
      transactionLimits: { databaseQueries: 2_048 },
    });
    const world = await seedWorld(t);
    await seedThreads(t, world, specs(400));

    expect(await inboxOf(t, "victim", { limit: 100 })).toHaveLength(100);
  });
});

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

describe("getInboxThread", () => {
  test("serves a thread outside the default window, as its inbox row", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    const ids = await seedThreads(t, world, specs(45));
    const oldest = ids[0];
    expect(
      (await inboxOf(t, "victim")).some((row) => row.threadId === oldest),
    ).toBe(false);

    const row = (await inboxOf(t, "victim", { limit: 45 })).find(
      (view) => view.threadId === oldest,
    );
    expect(row).toBeDefined();
    expect(await headerOf(t, "victim", oldest)).toEqual(row);
    // The other party sees their own side of it.
    expect((await headerOf(t, "mallory", oldest))?.threadId).toBe(oldest);
  });

  test("is null for a non-participant, an unknown thread and an unlisted circle thread", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    const [threadId] = await seedThreads(t, world, specs(1));
    expect(await headerOf(t, "carol", threadId)).toBeNull();
    expect(await headerOf(t, "victim", "no_such_thread")).toBeNull();

    // A circle thread the victim still has a row in, but whose circle no longer seats them
    // (the participant sync after a removal has not run yet).
    const circleThreadId = await t.run(async (ctx) => {
      await ctx.db.insert("circles", {
        aggregateId: "circle_1",
        ownerId: world.alice,
        name: "Puzzle Club",
        memberships: [
          {
            id: "seat_alice",
            memberId: world.alice,
            permission: "Admin",
            joinedAt: BASE,
          },
        ],
        createdAt: BASE,
      });
      const participants = [world.alice, world.victim];
      await ctx.db.insert("threads", {
        aggregateId: "circle_thread_1",
        subjectKind: "circle",
        circleId: "circle_1",
        participants,
        participantsKey: "circle:circle_1",
        lastMessageAt: BASE + 2_000,
        lastMessage: {
          messageId: "circle_m",
          authorId: world.alice,
          kind: "text",
          body: "Welcome!",
          sentAt: BASE + 2_000,
        },
        createdAt: BASE,
      });
      for (const memberId of participants) {
        await ctx.db.insert("threadParticipants", {
          threadAggregateId: "circle_thread_1",
          memberId,
          joinedAt: BASE,
          unreadCount: memberId === world.victim ? 1 : 0,
          lastActivityAt: BASE + 2_000,
        });
      }
      return "circle_thread_1";
    });
    expect(await headerOf(t, "victim", circleThreadId)).toBeNull();
    expect((await headerOf(t, "alice", circleThreadId))?.subject.kind).toBe(
      "circle",
    );
  });

  test("requires a signed-in member", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    const [threadId] = await seedThreads(t, world, specs(1));
    await expect(
      t.query(api.conversation.getInboxThread.getInboxThread, { threadId }),
    ).rejects.toThrow();
  });
});
