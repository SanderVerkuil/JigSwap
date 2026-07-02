import {
  Thread,
  toExchangeId,
  toMemberId,
  toMessageId,
  toThreadId,
  type MemberId,
} from "@jigswap/domain";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { convexThreadRepository } from "./conversation/adapters/convexThreadRepository";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// Seed two members and one exchange between them. The exchange row carries an aggregateId so the
// repository's `by_aggregate_id` resolution path is exercised; tests that want the raw-`_id`
// fallback pass the document id itself as the ExchangeId.
const seed = (t: ReturnType<typeof convexTest>) =>
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
    const puzzleId = await ctx.db.insert("puzzles", {
      title: "Test Puzzle",
      pieceCount: 1000,
      status: "approved",
      submittedBy: bob,
      createdAt: now,
      updatedAt: now,
    });
    const copyId = await ctx.db.insert("ownedPuzzles", {
      puzzleId,
      ownerId: bob,
      condition: "good",
      availability: { forTrade: true, forSale: false, forLend: false },
      createdAt: now,
      updatedAt: now,
    });
    const exchangeAggregateId = crypto.randomUUID();
    const exchangeDocId = await ctx.db.insert("exchanges", {
      aggregateId: exchangeAggregateId,
      initiatorId: alice,
      recipientId: bob,
      type: "trade",
      requestedPuzzleId: copyId,
      status: "proposed",
      createdAt: now,
      updatedAt: now,
    });
    return { alice, bob, exchangeAggregateId, exchangeDocId };
  });

const openDm = (a: MemberId, b: MemberId): Thread => {
  const result = Thread.openDm(toThreadId(crypto.randomUUID()), [a, b]);
  if (!result.isOk) throw new Error("openDm unexpectedly failed");
  return result.value;
};

const postText = (
  thread: Thread,
  author: MemberId,
  body: string,
  at: number,
) => {
  const result = thread.postMessage({
    id: toMessageId(crypto.randomUUID()),
    authorId: author,
    kind: "text",
    body,
    sentAt: new Date(at),
  });
  if (!result.isOk) throw new Error("postMessage unexpectedly failed");
  return result.value;
};

describe("convexThreadRepository", () => {
  test("saves a fresh DM thread with sorted participantsKey and participant rows", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seed(t);
    const a = toMemberId(alice);
    const b = toMemberId(bob);

    const thread = openDm(b, a); // deliberately unsorted input order
    await t.run((ctx) => convexThreadRepository(ctx).save(thread));

    const { row, participantRows } = await t.run(async (ctx) => ({
      row: await ctx.db
        .query("threads")
        .withIndex("by_aggregate_id", (q) =>
          q.eq("aggregateId", thread.id as string),
        )
        .unique(),
      participantRows: await ctx.db
        .query("threadParticipants")
        .withIndex("by_thread", (q) =>
          q.eq("threadAggregateId", thread.id as string),
        )
        .collect(),
    }));

    expect(row).not.toBeNull();
    expect(row?.subjectKind).toBe("dm");
    expect(row?.exchangeId).toBeUndefined();
    expect(row?.participantsKey).toBe([alice, bob].sort().join("|"));
    expect(row?.lastMessageAt).toBeUndefined();
    expect(participantRows).toHaveLength(2);
    expect(participantRows.map((p) => p.memberId).sort()).toEqual(
      [alice, bob].sort(),
    );
  });

  test("saves messages incrementally without duplicates and tracks lastMessageAt", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seed(t);
    const a = toMemberId(alice);
    const b = toMemberId(bob);

    const thread = openDm(a, b);
    postText(thread, a, "first", 1_000);
    await t.run((ctx) => convexThreadRepository(ctx).save(thread));

    const afterFirst = await t.run((ctx) =>
      ctx.db
        .query("threadMessages")
        .withIndex("by_thread_sent", (q) =>
          q.eq("threadAggregateId", thread.id as string),
        )
        .collect(),
    );
    expect(afterFirst).toHaveLength(1);
    expect(afterFirst[0].body).toBe("first");
    expect(afterFirst[0].authorId).toBe(alice);
    expect(afterFirst[0].kind).toBe("text");

    postText(thread, b, "second", 2_000);
    await t.run((ctx) => convexThreadRepository(ctx).save(thread));

    const { messages, row } = await t.run(async (ctx) => ({
      messages: await ctx.db
        .query("threadMessages")
        .withIndex("by_thread_sent", (q) =>
          q.eq("threadAggregateId", thread.id as string),
        )
        .collect(),
      row: await ctx.db
        .query("threads")
        .withIndex("by_aggregate_id", (q) =>
          q.eq("aggregateId", thread.id as string),
        )
        .unique(),
    }));
    expect(messages).toHaveLength(2);
    expect(messages.map((m) => m.body)).toEqual(["first", "second"]);
    expect(row?.lastMessageAt).toBe(2_000);
  });

  test("system message round-trips: null author, kind survives, no stored authorId", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seed(t);
    const thread = openDm(toMemberId(alice), toMemberId(bob));

    const posted = thread.postSystemMessage({
      id: toMessageId(crypto.randomUUID()),
      body: "exchange shipped",
      sentAt: new Date(4_000),
    });
    expect(posted.isOk).toBe(true);
    await t.run((ctx) => convexThreadRepository(ctx).save(thread));

    // The raw row must have NO authorId column value (system = service-authored).
    const raw = await t.run((ctx) =>
      ctx.db
        .query("threadMessages")
        .withIndex("by_thread_sent", (q) =>
          q.eq("threadAggregateId", thread.id as string),
        )
        .collect(),
    );
    expect(raw).toHaveLength(1);
    expect(raw[0].kind).toBe("system");
    expect(raw[0].authorId).toBeUndefined();

    // t.run results must be Convex values, so unwrap the aggregate to plain data inside.
    const roundTripped = await t.run(async (ctx) => {
      const found = await convexThreadRepository(ctx).findById(thread.id);
      return found === null
        ? null
        : found.messages.map((m) => ({
            authorId: m.authorId,
            kind: m.kind,
            body: m.body,
          }));
    });
    expect(roundTripped).toEqual([
      { authorId: null, kind: "system", body: "exchange shipped" },
    ]);
  });

  test("re-saving prunes a stale hand-inserted participant row back to the aggregate's set", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seed(t);
    const thread = openDm(toMemberId(alice), toMemberId(bob));

    await t.run((ctx) => convexThreadRepository(ctx).save(thread));
    // A stale duplicate row (e.g. from a crashed partial write) must be pruned on the next save.
    await t.run((ctx) =>
      ctx.db.insert("threadParticipants", {
        threadAggregateId: thread.id as string,
        memberId: alice,
      }),
    );
    await t.run((ctx) => convexThreadRepository(ctx).save(thread));

    const participantRows = await t.run((ctx) =>
      ctx.db
        .query("threadParticipants")
        .withIndex("by_thread", (q) =>
          q.eq("threadAggregateId", thread.id as string),
        )
        .collect(),
    );
    expect(participantRows).toHaveLength(2);
    expect(participantRows.map((p) => p.memberId).sort()).toEqual(
      [alice, bob].sort(),
    );
  });

  test("re-saving with unchanged participants does not duplicate participant rows", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seed(t);
    const thread = openDm(toMemberId(alice), toMemberId(bob));

    await t.run((ctx) => convexThreadRepository(ctx).save(thread));
    await t.run((ctx) => convexThreadRepository(ctx).save(thread));

    const participantRows = await t.run((ctx) =>
      ctx.db
        .query("threadParticipants")
        .withIndex("by_thread", (q) =>
          q.eq("threadAggregateId", thread.id as string),
        )
        .collect(),
    );
    expect(participantRows).toHaveLength(2);
  });

  test("findDmByParticipants is order-insensitive and ignores exchange threads", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, exchangeDocId } = await seed(t);
    const a = toMemberId(alice);
    const b = toMemberId(bob);

    // Exchange thread between the SAME pair (raw-`_id` fallback for the ExchangeId) must never
    // satisfy a DM lookup.
    const exchangeThread = Thread.openForExchange(
      toThreadId(crypto.randomUUID()),
      toExchangeId(exchangeDocId),
      [a, b],
    );
    const dmThread = openDm(a, b);
    await t.run(async (ctx) => {
      const repository = convexThreadRepository(ctx);
      await repository.save(exchangeThread);
      await repository.save(dmThread);
    });

    // t.run results must be Convex values, so unwrap the aggregates to plain data inside.
    const { ab, ba } = await t.run(async (ctx) => {
      const repository = convexThreadRepository(ctx);
      return {
        ab: (await repository.findDmByParticipants(a, b))?.id ?? null,
        ba: (await repository.findDmByParticipants(b, a))?.id ?? null,
      };
    });
    expect(ab).toBe(dmThread.id);
    expect(ba).toBe(dmThread.id);
  });

  test("findByExchange and findById round-trip full state including read receipts", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, exchangeAggregateId } = await seed(t);
    const a = toMemberId(alice);
    const b = toMemberId(bob);
    const exchangeId = toExchangeId(exchangeAggregateId);

    const thread = Thread.openForExchange(
      toThreadId(crypto.randomUUID()),
      exchangeId,
      [a, b],
    );
    postText(thread, a, "hello", 3_000);
    const marked = thread.markRead(b, new Date(5_000));
    expect(marked.isOk).toBe(true);
    await t.run((ctx) => convexThreadRepository(ctx).save(thread));

    // t.run results must be Convex values, so unwrap the aggregates to plain data inside.
    const byExchange = await t.run(async (ctx) => {
      const found =
        await convexThreadRepository(ctx).findByExchange(exchangeId);
      return found === null
        ? null
        : { id: found.id as string, subject: found.subject };
    });
    expect(byExchange?.id).toBe(thread.id);
    expect(byExchange?.subject).toEqual({ kind: "exchange", exchangeId });

    const byId = await t.run(async (ctx) => {
      const found = await convexThreadRepository(ctx).findById(thread.id);
      return found === null
        ? null
        : {
            participants: found.participants.map((p) => p as string),
            messages: found.messages.map((m) => ({
              body: m.body,
              sentAt: m.sentAt.getTime(),
            })),
            lastReadAtA: found.lastReadAt(a)?.getTime() ?? null,
            lastReadAtB: found.lastReadAt(b)?.getTime() ?? null,
          };
    });
    expect(byId?.participants.slice().sort()).toEqual(
      [a as string, b as string].sort(),
    );
    expect(byId?.messages).toEqual([{ body: "hello", sentAt: 3_000 }]);
    expect(byId?.lastReadAtB).toBe(5_000);
    expect(byId?.lastReadAtA).toBeNull();
  });

  test("hydrating an exchange-kind row without an exchangeId throws", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seed(t);

    await t.run(async (ctx) => {
      await ctx.db.insert("threads", {
        aggregateId: "corrupt-thread",
        subjectKind: "exchange",
        participants: [alice, bob],
        participantsKey: [alice, bob].sort().join("|"),
        readReceipts: [],
        createdAt: 0,
      });
    });

    await expect(
      t.run((ctx) =>
        convexThreadRepository(ctx).findById(toThreadId("corrupt-thread")),
      ),
    ).rejects.toThrow(/exchangeId/);
  });
});
