import { Thread, toMemberId, toMessageId, toThreadId } from "@jigswap/domain";
import { convexTest, type TestConvex } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { convexThreadRepository } from "./conversation/adapters/convexThreadRepository";
import { LAST_MESSAGE_BODY_MAX } from "./conversation/adapters/threadMapper";
import { BACKFILL_PARTICIPANT_STATE_BATCH } from "./conversation/backfillParticipantState";
import {
  UNREAD_SCAN_CAP,
  UNREAD_SCAN_READ_CAP,
} from "./conversation/readModelHelpers";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;

const seed = (t: T) =>
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
    // A mutual follow between alice and bob so the ConnectionPolicy allows their DM.
    await ctx.db.insert("follows", {
      followerId: alice,
      followeeId: bob,
      createdAt: 1,
    });
    await ctx.db.insert("follows", {
      followerId: bob,
      followeeId: alice,
      createdAt: 2,
    });
    return { alice, bob, carol };
  });

const asAlice = (t: T) => t.withIdentity({ subject: "clerk_alice" });
const asBob = (t: T) => t.withIdentity({ subject: "clerk_bob" });

// Message sentAt and receipts are Date.now() millis; yield a few real milliseconds between
// time-ordered actions so every instant in a test is strictly increasing.
const tick = () => new Promise((resolve) => setTimeout(resolve, 3));

const openDm = (t: T, bob: Id<"users">) =>
  asAlice(t).mutation(api.conversation.openDmThread.openDmThread, {
    recipientId: bob,
  });

const post = async (
  t: T,
  as: (t: T) => ReturnType<T["withIdentity"]>,
  threadId: string,
  body: string,
) => {
  await tick();
  await as(t).mutation(api.conversation.postMessage.postMessage, {
    threadId,
    kind: "text",
    body,
  });
};

// A legacy-shaped image message: postMessage is text-only, and the aggregate now refuses an image
// without an attachment, so the attachment-less message is rehydrated onto the thread and saved
// through the repository the way a pre-#145 image row was written.
const postLegacyImage = async (
  t: T,
  authorId: Id<"users">,
  threadId: string,
  body: string,
) => {
  await tick();
  await t.run(async (ctx) => {
    const repository = convexThreadRepository(ctx);
    const thread = await repository.findById(toThreadId(threadId));
    if (!thread) throw new Error("thread not found");
    const legacy = Thread.rehydrate({
      ...thread.toState(),
      messages: [
        {
          id: toMessageId(crypto.randomUUID()),
          authorId: toMemberId(authorId as string),
          kind: "image",
          body,
          sentAt: new Date(),
        },
      ],
    });
    await repository.save(legacy);
  });
};

// A service-authored system message, posted through the repository as the subscriber would.
const postSystem = async (t: T, threadId: string, body: string) => {
  await tick();
  await t.run(async (ctx) => {
    const repository = convexThreadRepository(ctx);
    const thread = await repository.findById(toThreadId(threadId));
    if (!thread) throw new Error("thread not found");
    const posted = thread.postSystemMessage({
      id: toMessageId(crypto.randomUUID()),
      body,
      sentAt: new Date(),
    });
    if (!posted.isOk) throw new Error("postSystemMessage failed");
    await repository.save(thread);
  });
};

const threadRow = (t: T, threadId: string) =>
  t.run(async (ctx) => {
    const row = await ctx.db
      .query("threads")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", threadId))
      .unique();
    if (!row) throw new Error("thread row missing");
    return row;
  });

const participantRow = (t: T, threadId: string, memberId: Id<"users">) =>
  t.run(async (ctx) => {
    const row = await ctx.db
      .query("threadParticipants")
      .withIndex("by_thread_member", (q) =>
        q.eq("threadAggregateId", threadId).eq("memberId", memberId),
      )
      .unique();
    if (!row) throw new Error("participant row missing");
    return row;
  });

// Convex sorts keys and strips undefined on write: compare documents in a canonical form.
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0,
          ),
        )
      : v,
  );

// Turn a thread back into its pre-denormalisation shape: no lastMessage, receipts on the thread
// row, participant rows without state. The reads must then fall back to the old computation.
const stripDenormalised = (t: T, threadId: string) =>
  t.run(async (ctx) => {
    const thread = await ctx.db
      .query("threads")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", threadId))
      .unique();
    if (!thread) throw new Error("thread row missing");
    const rows = await ctx.db
      .query("threadParticipants")
      .withIndex("by_thread", (q) => q.eq("threadAggregateId", threadId))
      .collect();
    await ctx.db.patch(thread._id, {
      lastMessage: undefined,
      readReceipts: rows
        .filter(
          (r): r is Doc<"threadParticipants"> & { lastReadAt: number } =>
            r.lastReadAt !== undefined,
        )
        .map((r) => ({ memberId: r.memberId, lastReadAt: r.lastReadAt })),
    });
    for (const row of rows) {
      await ctx.db.patch(row._id, {
        lastReadAt: undefined,
        unreadCount: undefined,
        lastActivityAt: undefined,
      });
    }
  });

// The repository over a ctx whose db logs every write as "<op>:<first arg>".
const recordingRepository = (ctx: MutationCtx) => {
  const log: string[] = [];
  const db = new Proxy(ctx.db, {
    get(target, prop, receiver) {
      const value: unknown = Reflect.get(target, prop, receiver);
      if (
        typeof value === "function" &&
        (prop === "insert" ||
          prop === "patch" ||
          prop === "replace" ||
          prop === "delete")
      ) {
        return (...args: unknown[]) => {
          log.push(`${prop}:${String(args[0])}`);
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      }
      return value;
    },
  });
  return { repository: convexThreadRepository({ ...ctx, db }), log };
};

describe("post path", () => {
  test("increments unread for the other participant only, and stamps activity + lastMessage", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seed(t);
    const threadId = await openDm(t, bob);

    const fresh = await participantRow(t, threadId, bob);
    expect(fresh.unreadCount).toBe(0);
    expect(fresh.lastReadAt).toBeUndefined();
    expect(fresh.lastActivityAt).toBe((await threadRow(t, threadId)).createdAt);

    await post(t, asAlice, threadId, "one");
    await post(t, asAlice, threadId, "two");

    const thread = await threadRow(t, threadId);
    const bobRow = await participantRow(t, threadId, bob);
    const aliceRow = await participantRow(t, threadId, alice);
    expect(bobRow.unreadCount).toBe(2);
    expect(aliceRow.unreadCount).toBe(0);
    expect(bobRow.lastActivityAt).toBe(thread.lastMessageAt);
    expect(aliceRow.lastActivityAt).toBe(thread.lastMessageAt);
    expect(thread.lastMessage).toMatchObject({
      authorId: alice,
      kind: "text",
      body: "two",
      sentAt: thread.lastMessageAt,
    });
    expect(thread.readReceipts).toBeUndefined();
  });

  test("a system message increments every participant's unread", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seed(t);
    const threadId = await openDm(t, bob);
    await post(t, asAlice, threadId, "hi");
    await postSystem(t, threadId, "exchange shipped");

    expect((await participantRow(t, threadId, alice)).unreadCount).toBe(1);
    expect((await participantRow(t, threadId, bob)).unreadCount).toBe(2);
    const thread = await threadRow(t, threadId);
    expect(thread.lastMessage?.kind).toBe("system");
    expect(thread.lastMessage?.authorId).toBeUndefined();
  });

  test("unread is capped at UNREAD_SCAN_CAP", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    const threadId = await openDm(t, bob);
    const row = await participantRow(t, threadId, bob);
    await t.run((ctx) =>
      ctx.db.patch(row._id, { unreadCount: UNREAD_SCAN_CAP - 1 }),
    );

    await post(t, asAlice, threadId, "forty-nine plus one");
    expect((await participantRow(t, threadId, bob)).unreadCount).toBe(
      UNREAD_SCAN_CAP,
    );
    await post(t, asAlice, threadId, "and another");
    expect((await participantRow(t, threadId, bob)).unreadCount).toBe(
      UNREAD_SCAN_CAP,
    );
  });

  test("a pre-backfill row without unreadCount derives it by the scan, including the new message", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seed(t);
    const threadId = await openDm(t, bob);
    await post(t, asAlice, threadId, "old one");
    await post(t, asAlice, threadId, "old two");
    await asBob(t).mutation(api.conversation.markThreadRead.markThreadRead, {
      threadId,
    });
    await post(t, asAlice, threadId, "after read");
    await stripDenormalised(t, threadId);

    await post(t, asAlice, threadId, "newest");
    // Scan: "after read" and "newest" are past bob's legacy receipt; alice authored all of them.
    expect((await participantRow(t, threadId, bob)).unreadCount).toBe(2);
    expect((await participantRow(t, threadId, alice)).unreadCount).toBe(0);
  });

  test("lastMessage truncates long bodies and blanks image bodies", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seed(t);
    const threadId = await openDm(t, bob);

    const long = "x".repeat(LAST_MESSAGE_BODY_MAX + 500);
    await post(t, asAlice, threadId, long);
    expect((await threadRow(t, threadId)).lastMessage?.body).toBe(
      "x".repeat(LAST_MESSAGE_BODY_MAX),
    );

    // An emoji (a surrogate pair) straddling the boundary is kept whole, never split.
    const emoji = "\u{1F9E9}";
    await post(
      t,
      asAlice,
      threadId,
      "y".repeat(LAST_MESSAGE_BODY_MAX - 1) + emoji + "tail",
    );
    const straddled = (await threadRow(t, threadId)).lastMessage?.body ?? "";
    expect(straddled).toBe("y".repeat(LAST_MESSAGE_BODY_MAX - 1) + emoji);
    expect(Array.from(straddled)).toHaveLength(LAST_MESSAGE_BODY_MAX);
    // No lone surrogate anywhere (a split pair would leave one).
    expect(straddled).not.toMatch(
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/,
    );

    await postLegacyImage(t, alice, threadId, "https://example.com/i.png");
    const thread = await threadRow(t, threadId);
    expect(thread.lastMessage?.kind).toBe("image");
    expect(thread.lastMessage?.body).toBe("");
  });
});

describe("markThreadRead", () => {
  test("resets only the caller's row and leaves the thread row untouched", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seed(t);
    const threadId = await openDm(t, bob);
    await post(t, asAlice, threadId, "one");
    await post(t, asBob, threadId, "reply");
    await post(t, asAlice, threadId, "two");

    const threadBefore = await threadRow(t, threadId);
    const aliceBefore = await participantRow(t, threadId, alice);
    expect(aliceBefore.unreadCount).toBe(1);
    expect((await participantRow(t, threadId, bob)).unreadCount).toBe(2);

    await tick();
    await asBob(t).mutation(api.conversation.markThreadRead.markThreadRead, {
      threadId,
    });

    const bobAfter = await participantRow(t, threadId, bob);
    expect(bobAfter.unreadCount).toBe(0);
    expect(bobAfter.lastReadAt).toBeGreaterThan(threadBefore.lastMessageAt!);
    expect(canonical(await participantRow(t, threadId, alice))).toBe(
      canonical(aliceBefore),
    );
    expect(canonical(await threadRow(t, threadId))).toBe(
      canonical(threadBefore),
    );
  });
});

describe("fallback scan read cap", () => {
  test("stops after UNREAD_SCAN_READ_CAP rows when the reader authored a long run", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seed(t);
    const threadId = "legacy-long-run";
    const own = UNREAD_SCAN_READ_CAP + 100;
    await t.run(async (ctx) => {
      await ctx.db.insert("threads", {
        aggregateId: threadId,
        subjectKind: "dm",
        participants: [alice, bob],
        participantsKey: [alice, bob].sort().join("|"),
        createdAt: 0,
        lastMessageAt: 3 + own,
      });
      for (const memberId of [alice, bob]) {
        await ctx.db.insert("threadParticipants", {
          threadAggregateId: threadId,
          memberId,
        });
      }
      // Three unread messages from alice, then a long run of bob's own messages after them.
      for (let i = 1; i <= 3 + own; i++) {
        await ctx.db.insert("threadMessages", {
          threadAggregateId: threadId,
          messageId: `m${i}`,
          authorId: i <= 3 ? alice : bob,
          kind: "text",
          body: `m${i}`,
          sentAt: i,
        });
      }
    });
    const bobTotal = () =>
      asBob(t).query(api.conversation.getUnreadTotal.getUnreadTotal, {});

    // The cap stops the scan inside bob's own run: 0 is a lower bound, not the true 3.
    expect(await bobTotal()).toBe(0);

    // Shorten bob's run below the cap: the scan now reaches alice's three messages.
    await t.run(async (ctx) => {
      const rows = await ctx.db
        .query("threadMessages")
        .withIndex("by_thread_sent", (q) =>
          q.eq("threadAggregateId", threadId).gt("sentAt", 3),
        )
        .take(200);
      for (const row of rows) await ctx.db.delete(row._id);
    });
    expect(await bobTotal()).toBe(3);
  });
});

describe("markThreadRead on a pre-backfill row", () => {
  test("moves the legacy receipt onto the caller's row and leaves the thread row untouched", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seed(t);
    const threadId = await openDm(t, bob);
    await post(t, asAlice, threadId, "one");
    await tick();
    await asBob(t).mutation(api.conversation.markThreadRead.markThreadRead, {
      threadId,
    });
    await post(t, asAlice, threadId, "two");
    await stripDenormalised(t, threadId);

    const threadBefore = await threadRow(t, threadId);
    const legacyReceipt = threadBefore.readReceipts?.find(
      (r) => r.memberId === bob,
    )?.lastReadAt;
    expect(legacyReceipt).toBeDefined();
    const aliceBefore = await participantRow(t, threadId, alice);
    expect(
      await asBob(t).query(api.conversation.getUnreadTotal.getUnreadTotal, {}),
    ).toBe(1);

    await tick();
    await asBob(t).mutation(api.conversation.markThreadRead.markThreadRead, {
      threadId,
    });

    const bobAfter = await participantRow(t, threadId, bob);
    expect(bobAfter.lastReadAt).toBeGreaterThan(legacyReceipt!);
    expect(bobAfter.unreadCount).toBe(0);
    expect(canonical(await threadRow(t, threadId))).toBe(
      canonical(threadBefore),
    );
    expect(canonical(await participantRow(t, threadId, alice))).toBe(
      canonical(aliceBefore),
    );
    expect(
      await asBob(t).query(api.conversation.getUnreadTotal.getUnreadTotal, {}),
    ).toBe(0);
  });
});

describe("receipt-only save", () => {
  test("writes nothing but the reader's participant row", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    const threadId = await openDm(t, bob);
    await post(t, asAlice, threadId, "one");
    const bobRow = await participantRow(t, threadId, bob);

    await tick();
    const writes = await t.run(async (ctx) => {
      const { repository, log } = recordingRepository(ctx);
      const thread = await repository.findById(toThreadId(threadId));
      if (!thread) throw new Error("thread not found");
      if (!thread.markRead(toMemberId(bob), new Date()).isOk) {
        throw new Error("markRead failed");
      }
      await repository.save(thread);
      return log;
    });
    expect(writes).toEqual([`patch:${bobRow._id}`]);
  });

  test("an unchanged receipt (same instant, unread already 0) writes nothing", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    const threadId = await openDm(t, bob);
    await post(t, asAlice, threadId, "one");
    const at = new Date(Date.now() + 10);

    const markAt = () =>
      t.run(async (ctx) => {
        const { repository, log } = recordingRepository(ctx);
        const thread = await repository.findById(toThreadId(threadId));
        if (!thread) throw new Error("thread not found");
        if (!thread.markRead(toMemberId(bob), at).isOk) {
          throw new Error("markRead failed");
        }
        await repository.save(thread);
        return log;
      });

    expect(await markAt()).toHaveLength(1);
    expect((await participantRow(t, threadId, bob)).unreadCount).toBe(0);
    expect(await markAt()).toEqual([]);
  });
});

describe("read fallback parity", () => {
  test("inbox and unread total are the same with and without the denormalised fields", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    const threadId = await openDm(t, bob);
    await post(t, asAlice, threadId, "one");
    await post(t, asBob, threadId, "reply");
    await tick();
    await asBob(t).mutation(api.conversation.markThreadRead.markThreadRead, {
      threadId,
    });
    await post(t, asAlice, threadId, "two");
    await post(t, asAlice, threadId, "three");

    const read = async () => ({
      aliceInbox: await asAlice(t).query(
        api.conversation.getMyInbox.getMyInbox,
        {},
      ),
      bobInbox: await asBob(t).query(
        api.conversation.getMyInbox.getMyInbox,
        {},
      ),
      bobTotal: await asBob(t).query(
        api.conversation.getUnreadTotal.getUnreadTotal,
        {},
      ),
    });

    const denormalised = await read();
    expect(denormalised.bobInbox[0].unreadCount).toBe(2);
    expect(denormalised.bobTotal).toBe(2);
    expect(denormalised.aliceInbox[0].unreadCount).toBe(1);
    expect(denormalised.bobInbox[0].lastMessage?.body).toBe("three");

    await stripDenormalised(t, threadId);
    expect(await read()).toEqual(denormalised);
  });
});

// convex-test serializes ConvexError.data to a JSON string at the function boundary; normalise.
const codeOf = (e: unknown): string | undefined => {
  const data = (e as ConvexError<Value>).data;
  return (
    typeof data === "string" ? JSON.parse(data) : (data as { code?: string })
  ).code;
};

describe("listThreadMessages", () => {
  const page = (
    t: T,
    threadId: string,
    numItems: number,
    cursor: string | null,
  ) =>
    asBob(t).query(api.conversation.listThreadMessages.listThreadMessages, {
      threadId,
      paginationOpts: { numItems, cursor },
    });

  test("pages newest first with stable cursor continuation", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    const threadId = await openDm(t, bob);
    for (const body of ["m1", "m2", "m3", "m4", "m5"]) {
      await post(t, asAlice, threadId, body);
    }

    const first = await page(t, threadId, 2, null);
    expect(first.page.map((m) => m.body)).toEqual(["m5", "m4"]);
    expect(first.isDone).toBe(false);
    const second = await page(t, threadId, 2, first.continueCursor);
    expect(second.page.map((m) => m.body)).toEqual(["m3", "m2"]);
    const third = await page(t, threadId, 2, second.continueCursor);
    expect(third.page.map((m) => m.body)).toEqual(["m1"]);
    expect(third.isDone).toBe(true);
  });

  test("maps rows exactly like getThreadMessages", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    const threadId = await openDm(t, bob);
    await post(t, asAlice, threadId, "hello");
    await post(t, asBob, threadId, "hi back");
    await postSystem(t, threadId, "exchange shipped");

    const paged = await page(t, threadId, 10, null);
    const legacy = await asBob(t).query(
      api.conversation.getThreadMessages.getThreadMessages,
      { threadId },
    );
    expect([...paged.page].reverse()).toEqual(legacy);
  });

  test("a new message appears at the top of the first page", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    const threadId = await openDm(t, bob);
    await post(t, asAlice, threadId, "old");
    const before = await page(t, threadId, 20, null);
    expect(before.page.map((m) => m.body)).toEqual(["old"]);

    await post(t, asAlice, threadId, "new");
    const after = await page(t, threadId, 20, null);
    expect(after.page.map((m) => m.body)).toEqual(["new", "old"]);
  });

  test("clamps the page size to 1..100", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seed(t);
    const threadId = await openDm(t, bob);
    await t.run(async (ctx) => {
      for (let i = 1; i <= 105; i++) {
        await ctx.db.insert("threadMessages", {
          threadAggregateId: threadId,
          messageId: `bulk-${i}`,
          authorId: alice,
          kind: "text",
          body: `bulk-${i}`,
          sentAt: i,
        });
      }
    });
    expect((await page(t, threadId, 1000, null)).page).toHaveLength(100);
    expect((await page(t, threadId, 0, null)).page).toHaveLength(1);
    expect((await page(t, threadId, -5, null)).page).toHaveLength(1);
  });

  test("refuses a non-participant and an unknown thread", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    const threadId = await openDm(t, bob);
    const asCarol = t.withIdentity({ subject: "clerk_carol" });
    const args = { paginationOpts: { numItems: 10, cursor: null } };

    const refused = asCarol.query(
      api.conversation.listThreadMessages.listThreadMessages,
      { threadId, ...args },
    );
    await expect(refused).rejects.toBeInstanceOf(ConvexError);
    expect(await refused.catch(codeOf)).toBe("NotParticipant");

    const missing = asCarol.query(
      api.conversation.listThreadMessages.listThreadMessages,
      { threadId: "no-such-thread", ...args },
    );
    expect(await missing.catch(codeOf)).toBe("ThreadNotFound");
  });
});

describe("backfillParticipantState", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const backfill = (
    t: T,
    args: { dryRun?: boolean; batchSize?: number } = {},
  ) =>
    t.mutation(
      internal.conversation.backfillParticipantState.backfillParticipantState,
      args,
    );

  const snapshot = (t: T) =>
    t.run(async (ctx) => ({
      threads: canonical(await ctx.db.query("threads").collect()),
      participants: canonical(
        await ctx.db.query("threadParticipants").collect(),
      ),
    }));

  // A DM with history, receipts and unread on both sides, plus an empty DM, in live shape.
  const seedThreads = async (t: T) => {
    const { alice, bob, carol } = await seed(t);
    const threadId = await openDm(t, bob);
    await post(t, asAlice, threadId, "one");
    await post(t, asBob, threadId, "reply");
    await tick();
    await asBob(t).mutation(api.conversation.markThreadRead.markThreadRead, {
      threadId,
    });
    await post(t, asAlice, threadId, "two");
    // An empty DM (bob and carol follow each other) stays without lastMessage.
    await t.run(async (ctx) => {
      await ctx.db.insert("follows", {
        followerId: bob,
        followeeId: carol,
        createdAt: 3,
      });
      await ctx.db.insert("follows", {
        followerId: carol,
        followeeId: bob,
        createdAt: 4,
      });
    });
    const emptyId = await asBob(t).mutation(
      api.conversation.openDmThread.openDmThread,
      { recipientId: carol },
    );
    return { alice, bob, threadId, emptyId };
  };

  test("restores the live denormalised state; a dry run writes nothing; a re-run patches 0", async () => {
    const t = convexTest(schema, modules);
    const { threadId, emptyId } = await seedThreads(t);
    const live = await t.run(async (ctx) => ({
      lastMessage: (
        await ctx.db
          .query("threads")
          .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", threadId))
          .unique()
      )?.lastMessage,
      participants: canonical(
        await ctx.db.query("threadParticipants").collect(),
      ),
    }));
    await stripDenormalised(t, threadId);
    await stripDenormalised(t, emptyId);

    const stripped = await snapshot(t);
    expect(await backfill(t, { dryRun: true })).toEqual({
      threadsScanned: 2,
      threadsPatched: 1,
      participantsPatched: 4,
    });
    expect(await snapshot(t)).toEqual(stripped);

    expect(await backfill(t)).toEqual({
      threadsScanned: 2,
      threadsPatched: 1,
      participantsPatched: 4,
    });
    const filled = await t.run(async (ctx) => ({
      lastMessage: (
        await ctx.db
          .query("threads")
          .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", threadId))
          .unique()
      )?.lastMessage,
      participants: canonical(
        await ctx.db.query("threadParticipants").collect(),
      ),
    }));
    expect(filled).toEqual(live);
    expect((await threadRow(t, emptyId)).lastMessage).toBeUndefined();

    expect(await backfill(t)).toEqual({
      threadsScanned: 2,
      threadsPatched: 0,
      participantsPatched: 0,
    });
  });

  test("reschedules itself until every thread is backfilled", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);
    const total = BACKFILL_PARTICIPANT_STATE_BATCH + 3;
    await t.run(async (ctx) => {
      for (let i = 0; i < total; i++) {
        const aggregateId = `legacy-${i}`;
        await ctx.db.insert("threads", {
          aggregateId,
          subjectKind: "dm",
          participants: [alice],
          participantsKey: alice,
          readReceipts: [],
          createdAt: i,
        });
        await ctx.db.insert("threadParticipants", {
          threadAggregateId: aggregateId,
          memberId: alice,
        });
      }
    });

    expect(await backfill(t)).toEqual({
      threadsScanned: BACKFILL_PARTICIPANT_STATE_BATCH,
      threadsPatched: 0,
      participantsPatched: BACKFILL_PARTICIPANT_STATE_BATCH,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const rows = await t.run((ctx) =>
      ctx.db.query("threadParticipants").collect(),
    );
    expect(rows).toHaveLength(total);
    expect(
      rows.every((r) => r.unreadCount === 0 && r.lastActivityAt !== undefined),
    ).toBe(true);
  });

  test("keeps live values and fills only the missing fields", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, threadId } = await seedThreads(t);
    const lastMessageBefore = (await threadRow(t, threadId)).lastMessage;
    const bobRow = await participantRow(t, threadId, bob);
    const aliceRow = await participantRow(t, threadId, alice);
    // bob: a live count that differs from what the scan would give, activity missing.
    // alice: every state field missing.
    await t.run(async (ctx) => {
      await ctx.db.patch(bobRow._id, {
        unreadCount: 7,
        lastActivityAt: undefined,
      });
      await ctx.db.patch(aliceRow._id, {
        lastReadAt: undefined,
        unreadCount: undefined,
        lastActivityAt: undefined,
      });
    });

    await backfill(t);

    const thread = await threadRow(t, threadId);
    const bobAfter = await participantRow(t, threadId, bob);
    const aliceAfter = await participantRow(t, threadId, alice);
    expect(canonical(thread.lastMessage)).toBe(canonical(lastMessageBefore));
    expect(bobAfter.unreadCount).toBe(7);
    expect(bobAfter.lastReadAt).toBe(bobRow.lastReadAt);
    expect(bobAfter.lastActivityAt).toBe(thread.lastMessageAt);
    // alice has no legacy receipt, so lastReadAt stays absent; bob's reply is her one unread.
    expect(aliceAfter.lastReadAt).toBeUndefined();
    expect(aliceAfter.unreadCount).toBe(1);
    expect(aliceAfter.lastActivityAt).toBe(thread.lastMessageAt);
  });

  test("batchSize sets the page size and carries to every rescheduled batch", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);
    await t.run(async (ctx) => {
      for (let i = 0; i < 5; i++) {
        await ctx.db.insert("threads", {
          aggregateId: `small-${i}`,
          subjectKind: "dm",
          participants: [alice],
          participantsKey: alice,
          createdAt: i,
        });
        await ctx.db.insert("threadParticipants", {
          threadAggregateId: `small-${i}`,
          memberId: alice,
        });
      }
    });

    expect(await backfill(t, { batchSize: 2 })).toMatchObject({
      threadsScanned: 2,
    });
    const scheduled = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    expect(scheduled[0].args[0]).toMatchObject({ batchSize: 2 });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const rows = await t.run((ctx) =>
      ctx.db.query("threadParticipants").collect(),
    );
    expect(rows.every((r) => r.lastActivityAt !== undefined)).toBe(true);
  });
});
