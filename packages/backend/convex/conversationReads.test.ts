import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

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
    return { alice, bob, carol };
  });

const asAlice = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice" });
const asBob = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_bob" });
const asCarol = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_carol" });

// Seed a mutual follow between the pair so the ConnectionPolicy's first clause passes.
const followMutually = (
  t: ReturnType<typeof convexTest>,
  a: Id<"users">,
  b: Id<"users">,
) =>
  t.run(async (ctx) => {
    await ctx.db.insert("follows", {
      followerId: a,
      followeeId: b,
      createdAt: 1,
    });
    await ctx.db.insert("follows", {
      followerId: b,
      followeeId: a,
      createdAt: 2,
    });
  });

// Seed a puzzle + a for-sale copy owned by `owner` so exchange.propose can run for real.
const seedSaleCopy = (t: ReturnType<typeof convexTest>, owner: Id<"users">) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const puzzleId = await ctx.db.insert("puzzles", {
      title: "Test Puzzle",
      pieceCount: 1000,
      status: "approved",
      submittedBy: owner,
      createdAt: now,
      updatedAt: now,
    });
    return ctx.db.insert("ownedPuzzles", {
      puzzleId,
      ownerId: owner,
      condition: "good",
      availability: { forTrade: false, forSale: true, forLend: false },
      createdAt: now,
      updatedAt: now,
    });
  });

// Drain the async event dispatcher: yield a macrotask so the pending runAfter(0) job fires, then
// await any in-progress jobs — looped a few times to settle the chain.
const flushScheduled = async (t: ReturnType<typeof convexTest>) => {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await t.finishInProgressScheduledFunctions();
  }
};

// Read receipts and message sentAt are both Date.now() millis; consecutive awaits can land on the
// same millisecond, making `sentAt > lastReadAt` (and the `before` cursor) ambiguous. Yield a few
// real milliseconds between time-ordered actions so every instant in a test is strictly increasing.
const tick = () => new Promise((resolve) => setTimeout(resolve, 3));

// convex-test serializes ConvexError.data to a JSON string at the function boundary; normalise.
const dataOf = (e: unknown): { code?: string } => {
  const data = (e as ConvexError<unknown>).data;
  return typeof data === "string"
    ? JSON.parse(data)
    : (data as { code?: string });
};

const expectConvexCode = async (p: Promise<unknown>, code: string) => {
  await expect(p).rejects.toBeInstanceOf(ConvexError);
  await p.catch((e: unknown) => {
    expect(dataOf(e).code).toBe(code);
  });
};

// Open a DM between alice and bob (mutual follow) and post the given bodies as alice.
const openDmWithMessages = async (
  t: ReturnType<typeof convexTest>,
  bob: Id<"users">,
  bodies: string[],
) => {
  const threadId = await asAlice(t).mutation(
    api.conversation.openDmThread.openDmThread,
    { recipientId: bob },
  );
  for (const body of bodies) {
    await tick();
    await asAlice(t).mutation(api.conversation.postMessage.postMessage, {
      threadId,
      kind: "text",
      body,
    });
  }
  return threadId;
};

describe("getMyInbox", () => {
  test("a DM with unread messages: unreadCount, lastMessage, dm subject with the other member", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seed(t);
    await followMutually(t, alice, bob);
    const threadId = await openDmWithMessages(t, bob, ["first", "second"]);

    const bobInbox = await asBob(t).query(
      api.conversation.getMyInbox.getMyInbox,
      {},
    );
    expect(bobInbox).toHaveLength(1);
    expect(bobInbox[0].threadId).toBe(threadId);
    expect(bobInbox[0].unreadCount).toBe(2);
    expect(bobInbox[0].lastMessage?.body).toBe("second");
    expect(bobInbox[0].lastMessage?.kind).toBe("text");
    expect(bobInbox[0].updatedAt).toBe(bobInbox[0].lastMessage?.sentAt);

    const subject = bobInbox[0].subject;
    expect(subject.kind).toBe("dm");
    if (subject.kind !== "dm") throw new Error("expected a dm subject");
    expect(subject.otherMember.anonymous).toBe(false);
    if (subject.otherMember.anonymous)
      throw new Error("expected a revealed member");
    expect(subject.otherMember.member._id).toBe(alice);
    expect(subject.otherMember.member.name).toBe("clerk_alice");

    // The author's own messages never count as unread for them.
    const aliceInbox = await asAlice(t).query(
      api.conversation.getMyInbox.getMyInbox,
      {},
    );
    expect(aliceInbox).toHaveLength(1);
    expect(aliceInbox[0].unreadCount).toBe(0);
  });

  test("marking read zeroes the count; a later post brings it back to 1", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seed(t);
    await followMutually(t, alice, bob);
    const threadId = await openDmWithMessages(t, bob, ["first", "second"]);

    await tick();
    await asBob(t).mutation(api.conversation.markThreadRead.markThreadRead, {
      threadId,
    });
    const afterRead = await asBob(t).query(
      api.conversation.getMyInbox.getMyInbox,
      {},
    );
    expect(afterRead[0].unreadCount).toBe(0);

    await tick();
    await asAlice(t).mutation(api.conversation.postMessage.postMessage, {
      threadId,
      kind: "text",
      body: "third",
    });
    const afterPost = await asBob(t).query(
      api.conversation.getMyInbox.getMyInbox,
      {},
    );
    expect(afterPost[0].unreadCount).toBe(1);
  });

  test("an exchange thread carries the exchange subject and the system lastMessage for both parties", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seed(t);
    const copy = await seedSaleCopy(t, bob);

    const exchangeId = await asAlice(t).mutation(api.exchange.propose.propose, {
      recipientId: bob,
      type: "sale",
      requestedPuzzleId: copy,
      salePrice: 1000,
    });
    await flushScheduled(t);

    for (const viewer of [asAlice(t), asBob(t)]) {
      const inbox = await viewer.query(
        api.conversation.getMyInbox.getMyInbox,
        {},
      );
      expect(inbox).toHaveLength(1);
      const subject = inbox[0].subject;
      expect(subject.kind).toBe("exchange");
      if (subject.kind !== "exchange")
        throw new Error("expected an exchange subject");
      expect(subject.exchangeId).toBe(exchangeId);
      expect(subject.exchangeType).toBe("sale");
      expect(subject.puzzleTitle).toBe("Test Puzzle");
      expect(inbox[0].lastMessage?.kind).toBe("system");
      expect(inbox[0].lastMessage?.body).toBe("Exchange proposed");
      expect(inbox[0].lastMessage?.authorId).toBeNull();
    }
  });
});

describe("non-participant access", () => {
  test("a non-participant sees an empty inbox and is rejected from thread reads", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seed(t);
    await followMutually(t, alice, bob);
    const dmThreadId = await openDmWithMessages(t, bob, ["private"]);

    const copy = await seedSaleCopy(t, bob);
    const exchangeId = await asAlice(t).mutation(api.exchange.propose.propose, {
      recipientId: bob,
      type: "sale",
      requestedPuzzleId: copy,
      salePrice: 1000,
    });
    await flushScheduled(t);

    expect(
      await asCarol(t).query(api.conversation.getMyInbox.getMyInbox, {}),
    ).toEqual([]);
    await expectConvexCode(
      asCarol(t).query(api.conversation.getThreadMessages.getThreadMessages, {
        threadId: dmThreadId,
      }),
      "NotParticipant",
    );
    await expectConvexCode(
      asCarol(t).query(
        api.conversation.getThreadByExchange.getThreadByExchange,
        { exchangeId },
      ),
      "NotParticipant",
    );
  });

  test("a missing thread is rejected with ThreadNotFound", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await expectConvexCode(
      asAlice(t).query(api.conversation.getThreadMessages.getThreadMessages, {
        threadId: "no-such-thread",
      }),
      "ThreadNotFound",
    );
  });
});

describe("getThreadMessages pagination", () => {
  // Cursor semantics under test: a page is the `limit` NEWEST messages strictly older than
  // `before` (all messages when `before` is absent), returned ascending by sentAt. So the first
  // call yields the latest window and `before = page[0].sentAt` walks older history.
  test("limit 2 returns the newest two ascending; before pages the older remainder", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seed(t);
    await followMutually(t, alice, bob);
    const threadId = await openDmWithMessages(t, bob, ["m1", "m2", "m3"]);

    const latest = await asAlice(t).query(
      api.conversation.getThreadMessages.getThreadMessages,
      { threadId, limit: 2 },
    );
    expect(latest.map((m) => m.body)).toEqual(["m2", "m3"]);
    expect(latest.map((m) => m.authorId)).toEqual([alice, alice]);

    const older = await asAlice(t).query(
      api.conversation.getThreadMessages.getThreadMessages,
      { threadId, limit: 2, before: latest[0].sentAt },
    );
    expect(older.map((m) => m.body)).toEqual(["m1"]);
  });
});

describe("getThreadByExchange", () => {
  test("returns the thread aggregateId for a participant; null when no thread exists", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seed(t);
    const copy = await seedSaleCopy(t, bob);
    const exchangeId = await asAlice(t).mutation(api.exchange.propose.propose, {
      recipientId: bob,
      type: "sale",
      requestedPuzzleId: copy,
      salePrice: 1000,
    });

    // The thread is opened by the (scheduled) subscriber; before the flush there is none.
    expect(
      await asAlice(t).query(
        api.conversation.getThreadByExchange.getThreadByExchange,
        { exchangeId },
      ),
    ).toBeNull();

    await flushScheduled(t);
    const threadId = await asAlice(t).query(
      api.conversation.getThreadByExchange.getThreadByExchange,
      { exchangeId },
    );
    const inbox = await asBob(t).query(
      api.conversation.getMyInbox.getMyInbox,
      {},
    );
    expect(threadId).toBe(inbox[0].threadId);
  });
});

describe("canMessage", () => {
  test("mutual followers true; strangers false; self false", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, carol } = await seed(t);
    await followMutually(t, alice, bob);

    expect(
      await asAlice(t).query(api.conversation.canMessage.canMessage, {
        recipientId: bob,
      }),
    ).toBe(true);
    expect(
      await asAlice(t).query(api.conversation.canMessage.canMessage, {
        recipientId: carol,
      }),
    ).toBe(false);
    expect(
      await asAlice(t).query(api.conversation.canMessage.canMessage, {
        recipientId: alice,
      }),
    ).toBe(false);
  });
});

describe("getUnreadTotal", () => {
  test("sums unread across the caller's threads", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, carol } = await seed(t);
    await followMutually(t, alice, bob);
    await followMutually(t, carol, bob);

    // Thread 1: alice -> bob, two unread.
    await openDmWithMessages(t, bob, ["one", "two"]);
    // Thread 2: carol -> bob, one unread.
    const second = await asCarol(t).mutation(
      api.conversation.openDmThread.openDmThread,
      { recipientId: bob },
    );
    await tick();
    await asCarol(t).mutation(api.conversation.postMessage.postMessage, {
      threadId: second,
      kind: "text",
      body: "three",
    });

    expect(
      await asBob(t).query(api.conversation.getUnreadTotal.getUnreadTotal, {}),
    ).toBe(3);
    // A sender has nothing unread — their own messages never count.
    expect(
      await asAlice(t).query(
        api.conversation.getUnreadTotal.getUnreadTotal,
        {},
      ),
    ).toBe(0);
  });
});
