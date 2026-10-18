import { convexTest, type TestConvex } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const seed = (t: TestConvex<typeof schema>) =>
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

const asAlice = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_alice" });
const asBob = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_bob" });
const asCarol = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_carol" });

// Seed a mutual follow between the pair so the ConnectionPolicy's first clause passes.
const followMutually = (
  t: TestConvex<typeof schema>,
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

// Seed shared circle membership between the pair (the circle row itself is irrelevant to the
// policy, which only consults the circleMembers projection).
const shareCircle = (
  t: TestConvex<typeof schema>,
  a: Id<"users">,
  b: Id<"users">,
) =>
  t.run(async (ctx) => {
    const circleAggregateId = crypto.randomUUID();
    await ctx.db.insert("circleMembers", { circleAggregateId, memberId: a });
    await ctx.db.insert("circleMembers", { circleAggregateId, memberId: b });
  });

// convex-test serializes ConvexError.data to a JSON string at the function boundary; normalise.
const dataOf = (e: unknown): { code?: string } => {
  const data = (e as ConvexError<Value>).data;
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

describe("openDmThread", () => {
  test("mutual followers can open a DM; a second open returns the same thread", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seed(t);
    await followMutually(t, alice, bob);

    const threadId = await asAlice(t).mutation(
      api.conversation.openDmThread.openDmThread,
      { recipientId: bob },
    );
    expect(typeof threadId).toBe("string");

    // Idempotent per pair — the recipient opening from the other side lands on the same thread.
    const again = await asBob(t).mutation(
      api.conversation.openDmThread.openDmThread,
      { recipientId: alice },
    );
    expect(again).toBe(threadId);

    const rows = await t.run((ctx) => ctx.db.query("threads").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].subjectKind).toBe("dm");
  });

  test("circle-mates can open a DM", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seed(t);
    await shareCircle(t, alice, bob);

    const threadId = await asAlice(t).mutation(
      api.conversation.openDmThread.openDmThread,
      { recipientId: bob },
    );
    expect(typeof threadId).toBe("string");
  });

  test("a pair with an existing exchange thread can open a DM (no follow, no circle)", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seed(t);

    // Hand-seed an exchange-kind thread row between the pair; the policy's pair-thread clause
    // only touches participantsKey, never hydrating the row.
    const exchangeThreadId = crypto.randomUUID();
    await t.run(async (ctx) => {
      await ctx.db.insert("threads", {
        aggregateId: exchangeThreadId,
        subjectKind: "exchange",
        participants: [alice, bob],
        participantsKey: [alice, bob].sort().join("|"),
        readReceipts: [],
        createdAt: Date.now(),
      });
    });

    const dmThreadId = await asAlice(t).mutation(
      api.conversation.openDmThread.openDmThread,
      { recipientId: bob },
    );
    expect(typeof dmThreadId).toBe("string");
    expect(dmThreadId).not.toBe(exchangeThreadId);
  });

  test("strangers are rejected with NotConnected", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    await expectConvexCode(
      asAlice(t).mutation(api.conversation.openDmThread.openDmThread, {
        recipientId: bob,
      }),
      "NotConnected",
    );
  });

  test("unauthenticated callers are rejected", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    await expect(
      t.mutation(api.conversation.openDmThread.openDmThread, {
        recipientId: bob,
      }),
    ).rejects.toThrow(/Unauthenticated/);
  });

  test("a self-DM is rejected before any connection check", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);
    await expectConvexCode(
      asAlice(t).mutation(api.conversation.openDmThread.openDmThread, {
        recipientId: alice,
      }),
      "DmRequiresTwoParticipants",
    );
  });
});

describe("postMessage", () => {
  const openThread = async (t: TestConvex<typeof schema>) => {
    const { alice, bob, carol } = await seed(t);
    await followMutually(t, alice, bob);
    const threadId = await asAlice(t).mutation(
      api.conversation.openDmThread.openDmThread,
      { recipientId: bob },
    );
    return { alice, bob, carol, threadId };
  };

  test("a participant posts and the message row is persisted", async () => {
    const t = convexTest(schema, modules);
    const { alice, threadId } = await openThread(t);

    const messageId = await asAlice(t).mutation(
      api.conversation.postMessage.postMessage,
      { threadId, kind: "text", body: "hello there" },
    );
    expect(typeof messageId).toBe("string");

    const rows = await t.run((ctx) =>
      ctx.db
        .query("threadMessages")
        .withIndex("by_thread_sent", (q) => q.eq("threadAggregateId", threadId))
        .collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].messageId).toBe(messageId);
    expect(rows[0].body).toBe("hello there");
    expect(rows[0].kind).toBe("text");
    expect(rows[0].authorId).toBe(alice);
  });

  test("a non-participant is rejected", async () => {
    const t = convexTest(schema, modules);
    const { threadId } = await openThread(t);
    await expectConvexCode(
      asCarol(t).mutation(api.conversation.postMessage.postMessage, {
        threadId,
        kind: "text",
        body: "let me in",
      }),
      "NotParticipant",
    );
  });

  test("an empty body is rejected", async () => {
    const t = convexTest(schema, modules);
    const { threadId } = await openThread(t);
    await expectConvexCode(
      asAlice(t).mutation(api.conversation.postMessage.postMessage, {
        threadId,
        kind: "text",
        body: "",
      }),
      "EmptyMessage",
    );
  });

  test("an image message is rejected server-side and nothing is persisted", async () => {
    const t = convexTest(schema, modules);
    const { threadId } = await openThread(t);
    // A hand-crafted call (the typed client only allows "text"): the argument validator refuses
    // any kind other than text, so an arbitrary "image" body can never be stored.
    const args = {
      threadId,
      kind: "image",
      body: "https://evil.example/x.png",
    } as unknown as { threadId: string; kind: "text"; body: string };
    await expect(
      asAlice(t).mutation(api.conversation.postMessage.postMessage, args),
    ).rejects.toThrow(/Expected `text`, got `image`/);
    const rows = await t.run((ctx) =>
      ctx.db
        .query("threadMessages")
        .withIndex("by_thread_sent", (q) => q.eq("threadAggregateId", threadId))
        .collect(),
    );
    expect(rows).toHaveLength(0);
  });

  test("a missing thread is rejected with ThreadNotFound", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await expectConvexCode(
      asAlice(t).mutation(api.conversation.postMessage.postMessage, {
        threadId: "no-such-thread",
        kind: "text",
        body: "hello?",
      }),
      "ThreadNotFound",
    );
  });

  test("unauthenticated callers are rejected", async () => {
    const t = convexTest(schema, modules);
    const { threadId } = await openThread(t);
    await expect(
      t.mutation(api.conversation.postMessage.postMessage, {
        threadId,
        kind: "text",
        body: "hi",
      }),
    ).rejects.toThrow(/Unauthenticated/);
  });
});

describe("markThreadRead", () => {
  test("updates only the caller's receipt", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seed(t);
    await followMutually(t, alice, bob);
    const threadId = await asAlice(t).mutation(
      api.conversation.openDmThread.openDmThread,
      { recipientId: bob },
    );
    await asAlice(t).mutation(api.conversation.postMessage.postMessage, {
      threadId,
      kind: "text",
      body: "read me",
    });

    await asBob(t).mutation(api.conversation.markThreadRead.markThreadRead, {
      threadId,
    });

    // Receipts persist on the participant rows (threads.readReceipts is no longer written).
    const rows = await t.run((ctx) =>
      ctx.db
        .query("threadParticipants")
        .withIndex("by_thread", (q) => q.eq("threadAggregateId", threadId))
        .collect(),
    );
    const receiptOf = (memberId: Id<"users">) =>
      rows.find((r) => r.memberId === memberId)?.lastReadAt ?? null;
    expect(receiptOf(bob)).not.toBeNull();
    expect(receiptOf(alice)).toBeNull();
  });

  test("a non-participant is rejected", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seed(t);
    await followMutually(t, alice, bob);
    const threadId = await asAlice(t).mutation(
      api.conversation.openDmThread.openDmThread,
      { recipientId: bob },
    );
    await expectConvexCode(
      asCarol(t).mutation(api.conversation.markThreadRead.markThreadRead, {
        threadId,
      }),
      "NotParticipant",
    );
  });
});
