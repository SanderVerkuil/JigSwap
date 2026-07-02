import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// Fixed base instant so every sentAt/createdAt assertion is deterministic.
const BASE = 1_700_000_000_000;

// Two exchanges with legacy `messages` rows. Exchange 1 (alice <-> bob) carries three messages
// seeded OUT of createdAt order (newest first) including a system row; exchange 2 (carol <-> bob)
// carries one. Plus two message_received notifications: one legacy row whose relatedId is the
// exchange _id (must be remapped) and one already carrying a thread aggregateId (must be kept).
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
    const carol = await mkUser("clerk_carol");

    const puzzleId = await ctx.db.insert("puzzles", {
      title: "Test Puzzle",
      pieceCount: 1000,
      status: "approved",
      submittedBy: bob,
      createdAt: now,
      updatedAt: now,
    });
    const bobsCopy = await ctx.db.insert("ownedPuzzles", {
      puzzleId,
      ownerId: bob,
      condition: "good",
      availability: { forTrade: true, forSale: false, forLend: false },
      createdAt: now,
      updatedAt: now,
    });

    const exchange1 = await ctx.db.insert("exchanges", {
      aggregateId: "exch-1",
      initiatorId: alice,
      recipientId: bob,
      type: "trade",
      requestedPuzzleId: bobsCopy,
      status: "proposed",
      createdAt: BASE,
      updatedAt: BASE,
    });
    const exchange2 = await ctx.db.insert("exchanges", {
      aggregateId: "exch-2",
      initiatorId: carol,
      recipientId: bob,
      type: "trade",
      requestedPuzzleId: bobsCopy,
      status: "proposed",
      createdAt: BASE,
      updatedAt: BASE,
    });

    // Exchange 1 history, inserted newest-first to prove the backfill orders by createdAt.
    const e1Third = await ctx.db.insert("messages", {
      exchangeId: exchange1,
      senderId: alice,
      receiverId: bob,
      content: "third",
      messageType: "text",
      isRead: false,
      createdAt: BASE + 300,
    });
    const e1System = await ctx.db.insert("messages", {
      exchangeId: exchange1,
      senderId: alice,
      receiverId: bob,
      content: "Exchange proposed",
      messageType: "system",
      isRead: false,
      createdAt: BASE + 100,
    });
    const e1Second = await ctx.db.insert("messages", {
      exchangeId: exchange1,
      senderId: bob,
      receiverId: alice,
      content: "second",
      messageType: "text",
      isRead: false,
      createdAt: BASE + 200,
    });
    const e2First = await ctx.db.insert("messages", {
      exchangeId: exchange2,
      senderId: carol,
      receiverId: bob,
      content: "hi bob",
      messageType: "text",
      isRead: false,
      createdAt: BASE + 150,
    });

    // Legacy notification: relatedId is the exchange _id (old sendExchangeMessage shape).
    const staleNotification = await ctx.db.insert("notifications", {
      userId: bob,
      type: "message_received",
      title: "New Message",
      message: "You have a new message in your trade conversation",
      relatedId: exchange1 as string,
      isRead: false,
      createdAt: BASE + 300,
    });
    // Post-cutover notification: relatedId is already a thread aggregateId.
    const freshNotification = await ctx.db.insert("notifications", {
      userId: bob,
      type: "message_received",
      title: "New Message",
      message: "You have a new message",
      relatedId: "thread-already",
      isRead: false,
      createdAt: BASE + 400,
    });

    return {
      alice,
      bob,
      carol,
      exchange1,
      exchange2,
      e1Third,
      e1System,
      e1Second,
      e2First,
      staleNotification,
      freshNotification,
    };
  });

const runBackfill = (t: ReturnType<typeof convexTest>) =>
  t.mutation(internal.conversation.backfill.run, {});

const threadForExchange = (
  t: ReturnType<typeof convexTest>,
  exchangeId: Id<"exchanges">,
) =>
  t.run(async (ctx) => {
    const thread = await ctx.db
      .query("threads")
      .withIndex("by_exchange", (q) => q.eq("exchangeId", exchangeId))
      .unique();
    if (!thread) throw new Error("expected a thread for the exchange");
    return thread;
  });

const messagesOf = (t: ReturnType<typeof convexTest>, aggregateId: string) =>
  t.run((ctx) =>
    ctx.db
      .query("threadMessages")
      .withIndex("by_thread_sent", (q) =>
        q.eq("threadAggregateId", aggregateId),
      )
      .collect(),
  );

const receiptOf = (thread: Doc<"threads">, memberId: Id<"users">) =>
  thread.readReceipts.find((receipt) => receipt.memberId === memberId)
    ?.lastReadAt;

describe("conversation backfill", () => {
  test("creates one thread per exchange with converted messages, receipts and lastMessageAt", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    const result = await runBackfill(t);
    expect(result.isDone).toBe(true);
    expect(result.threadsCreated).toBe(2);
    expect(result.messagesCopied).toBe(4);

    const thread1 = await threadForExchange(t, s.exchange1);
    expect(thread1.subjectKind).toBe("exchange");
    expect(new Set(thread1.participants)).toEqual(new Set([s.alice, s.bob]));
    expect(thread1.participantsKey).toBe(
      [s.alice as string, s.bob as string].sort().join("|"),
    );
    // createdAt = first message's instant; lastMessageAt = the newest's.
    expect(thread1.createdAt).toBe(BASE + 100);
    expect(thread1.lastMessageAt).toBe(BASE + 300);
    // Both parties' receipts are stamped at the newest message (no stale unread wall).
    expect(receiptOf(thread1, s.alice)).toBe(BASE + 300);
    expect(receiptOf(thread1, s.bob)).toBe(BASE + 300);

    // Messages land in createdAt order despite the out-of-order seeding, with the field mapping
    // senderId->authorId (system -> absent), messageType->kind, content->body, createdAt->sentAt
    // and the derived legacy-<_id> messageId for idempotency.
    const messages1 = await messagesOf(t, thread1.aggregateId);
    expect(messages1.map((m) => m.body)).toEqual([
      "Exchange proposed",
      "second",
      "third",
    ]);
    expect(messages1.map((m) => m.kind)).toEqual(["system", "text", "text"]);
    expect(messages1.map((m) => m.authorId)).toEqual([
      undefined,
      s.bob,
      s.alice,
    ]);
    expect(messages1.map((m) => m.sentAt)).toEqual([
      BASE + 100,
      BASE + 200,
      BASE + 300,
    ]);
    expect(messages1.map((m) => m.messageId)).toEqual([
      `legacy-${s.e1System}`,
      `legacy-${s.e1Second}`,
      `legacy-${s.e1Third}`,
    ]);

    const thread2 = await threadForExchange(t, s.exchange2);
    const messages2 = await messagesOf(t, thread2.aggregateId);
    expect(messages2.map((m) => m.body)).toEqual(["hi bob"]);
    expect(receiptOf(thread2, s.carol)).toBe(BASE + 150);
    expect(receiptOf(thread2, s.bob)).toBe(BASE + 150);

    // The participant projection carries both members of both threads.
    const participants = await t.run((ctx) =>
      ctx.db.query("threadParticipants").collect(),
    );
    expect(participants).toHaveLength(4);
  });

  test("running twice changes nothing (idempotent)", async () => {
    const t = convexTest(schema, modules);
    await seed(t);

    await runBackfill(t);
    const snapshot = await t.run(async (ctx) => ({
      threads: await ctx.db.query("threads").collect(),
      threadMessages: await ctx.db.query("threadMessages").collect(),
      threadParticipants: await ctx.db.query("threadParticipants").collect(),
      notifications: await ctx.db.query("notifications").collect(),
    }));

    const second = await runBackfill(t);
    expect(second.threadsCreated).toBe(0);
    expect(second.messagesCopied).toBe(0);
    expect(second.notificationsRemapped).toBe(0);

    const after = await t.run(async (ctx) => ({
      threads: await ctx.db.query("threads").collect(),
      threadMessages: await ctx.db.query("threadMessages").collect(),
      threadParticipants: await ctx.db.query("threadParticipants").collect(),
      notifications: await ctx.db.query("notifications").collect(),
    }));
    expect(after).toEqual(snapshot);
  });

  test("merges into a pre-existing thread without duplicating already-copied messages", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    // The subscriber already opened exchange 1's thread post-deploy (one system message, newer
    // than the legacy history) and one legacy message was already copied by a partial prior run.
    await t.run(async (ctx) => {
      await ctx.db.insert("threads", {
        aggregateId: "pre-thread-1",
        subjectKind: "exchange",
        exchangeId: s.exchange1,
        participants: [s.alice, s.bob],
        participantsKey: [s.alice as string, s.bob as string].sort().join("|"),
        readReceipts: [{ memberId: s.alice, lastReadAt: BASE + 50 }],
        lastMessageAt: BASE + 1000,
        createdAt: BASE + 90,
      });
      for (const memberId of [s.alice, s.bob]) {
        await ctx.db.insert("threadParticipants", {
          threadAggregateId: "pre-thread-1",
          memberId,
        });
      }
      await ctx.db.insert("threadMessages", {
        threadAggregateId: "pre-thread-1",
        messageId: "subscriber-1",
        kind: "system",
        body: "Exchange proposed",
        sentAt: BASE + 1000,
      });
      await ctx.db.insert("threadMessages", {
        threadAggregateId: "pre-thread-1",
        messageId: `legacy-${s.e1System}`,
        kind: "system",
        body: "Exchange proposed",
        sentAt: BASE + 100,
      });
    });

    const result = await runBackfill(t);
    // Exchange 1 merges (2 new rows: "second"/"third"); exchange 2 still gets its thread.
    expect(result.threadsCreated).toBe(1);
    expect(result.messagesCopied).toBe(3);

    const thread1 = await threadForExchange(t, s.exchange1);
    expect(thread1.aggregateId).toBe("pre-thread-1");

    const messages = await messagesOf(t, "pre-thread-1");
    expect(messages.map((m) => m.body)).toEqual([
      "Exchange proposed",
      "second",
      "third",
      "Exchange proposed",
    ]);
    // No duplicate for the already-copied legacy row.
    expect(new Set(messages.map((m) => m.messageId)).size).toBe(4);

    // Receipts are raised to the newest LEGACY instant only (raise-only: alice's stale receipt
    // moves up, bob's is added); the newer live system message stays genuinely unread and the
    // thread's lastMessageAt is not lowered.
    expect(receiptOf(thread1, s.alice)).toBe(BASE + 300);
    expect(receiptOf(thread1, s.bob)).toBe(BASE + 300);
    expect(thread1.lastMessageAt).toBe(BASE + 1000);
  });

  test("remaps legacy message_received notifications to the thread; thread-shaped rows untouched", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    await runBackfill(t);

    const thread1 = await threadForExchange(t, s.exchange1);
    const stale = await t.run((ctx) => ctx.db.get(s.staleNotification));
    expect(stale?.relatedId).toBe(thread1.aggregateId);
    const fresh = await t.run((ctx) => ctx.db.get(s.freshNotification));
    expect(fresh?.relatedId).toBe("thread-already");
  });

  test("backfilled threads render in getMyInbox for a participant with unreadCount 0", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    await runBackfill(t);

    const inbox = await t
      .withIdentity({ subject: "clerk_bob" })
      .query(api.conversation.getMyInbox.getMyInbox, {});
    expect(inbox).toHaveLength(2);
    // Newest activity first: exchange 1 (BASE+300) before exchange 2 (BASE+150).
    expect(inbox.map((row) => row.lastMessage?.body)).toEqual([
      "third",
      "hi bob",
    ]);
    // Receipts were stamped at the newest message, so nothing reads as unread.
    expect(inbox.map((row) => row.unreadCount)).toEqual([0, 0]);
    for (const row of inbox) {
      expect(row.subject.kind).toBe("exchange");
      if (row.subject.kind !== "exchange")
        throw new Error("expected an exchange subject");
      expect(row.subject.puzzleTitle).toBe("Test Puzzle");
    }
    expect(
      inbox[0].subject.kind === "exchange" && inbox[0].subject.exchangeId,
    ).toBe("exch-1");
  });
});
