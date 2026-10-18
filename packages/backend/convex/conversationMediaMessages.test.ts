import {
  Thread,
  toMemberId,
  toMessageId,
  toThreadId,
  type MessageState,
} from "@jigswap/domain";
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { convexThreadRepository } from "./conversation/adapters/convexThreadRepository";
import {
  LAST_MESSAGE_BODY_MAX,
  toLastMessage,
  toMessageRow,
} from "./conversation/adapters/threadMapper";
import { toThreadMessageView } from "./conversation/readModelHelpers";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;

const alice = toMemberId("alice");

const mediaState = (over: Partial<MessageState> = {}): MessageState => ({
  id: toMessageId("m-1"),
  authorId: alice,
  kind: "image",
  body: "the box, unopened",
  sentAt: new Date(1_000),
  attachmentRef: "att-1",
  ...over,
});

describe("threadMapper: media rows", () => {
  test.each(["image", "location"] as const)(
    "a %s message maps attachmentRef to attachmentId and back out to the view with its caption",
    (kind) => {
      const row = toMessageRow("thread-1", mediaState({ kind }));
      expect(row).toMatchObject({
        kind,
        body: "the box, unopened",
        attachmentId: "att-1",
      });

      expect(toThreadMessageView(row)).toEqual({
        id: "m-1",
        authorId: "alice",
        kind,
        body: "the box, unopened",
        sentAt: 1_000,
        attachmentId: "att-1",
      });
    },
  );

  test("a text message stores no attachmentId", () => {
    const row = toMessageRow(
      "thread-1",
      mediaState({ kind: "text", body: "hi", attachmentRef: undefined }),
    );
    expect(row).not.toHaveProperty("attachmentId");
    expect(toThreadMessageView(row)).not.toHaveProperty("attachmentId");
  });

  test.each(["image", "location"] as const)(
    "toLastMessage keeps a %s row's kind and caption and never its attachment ref",
    (kind) => {
      const summary = toLastMessage(
        toMessageRow("thread-1", mediaState({ kind })),
      );
      expect(summary).toEqual({
        messageId: "m-1",
        authorId: "alice",
        kind,
        body: "the box, unopened",
        sentAt: 1_000,
      });
      expect(JSON.stringify(summary)).not.toContain("att-1");
    },
  );

  test("toLastMessage gives an uncaptioned photo an empty body", () => {
    const summary = toLastMessage(
      toMessageRow("thread-1", mediaState({ body: "" })),
    );
    expect(summary.kind).toBe("image");
    expect(summary.body).toBe("");
  });

  test("toLastMessage truncates a long caption like a text body", () => {
    const summary = toLastMessage(
      toMessageRow(
        "thread-1",
        mediaState({ kind: "location", body: "c".repeat(1_000) }),
      ),
    );
    expect(summary.body).toBe("c".repeat(LAST_MESSAGE_BODY_MAX));
  });

  test("a legacy image row (no attachmentId) is still blanked in the view and the summary", () => {
    const legacy = toMessageRow(
      "thread-1",
      mediaState({
        body: "https://evil.example/x.png",
        attachmentRef: undefined,
      }),
    );
    expect(toThreadMessageView(legacy).body).toBe("");
    expect(toThreadMessageView(legacy)).not.toHaveProperty("attachmentId");
    expect(toLastMessage(legacy).body).toBe("");
  });
});

// --- Through the repository and the read models ---

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
    return { alice, bob };
  });

const asAlice = (t: T) => t.withIdentity({ subject: "clerk_alice" });
const asBob = (t: T) => t.withIdentity({ subject: "clerk_bob" });

// Media is not postable by clients: post it the way internal server code will, through the
// aggregate and the repository (the PostMessage use case's own path).
const postMedia = (
  t: T,
  authorId: Id<"users">,
  threadId: string,
  kind: "image" | "location",
  caption: string,
  attachmentRef: string,
) =>
  t.run(async (ctx) => {
    const repository = convexThreadRepository(ctx);
    const thread = await repository.findById(toThreadId(threadId));
    if (!thread) throw new Error("thread not found");
    const posted = thread.postMessage({
      id: toMessageId(crypto.randomUUID()),
      authorId: toMemberId(authorId as string),
      kind,
      body: caption,
      sentAt: new Date(),
      attachmentRef,
    });
    if (!posted.isOk)
      throw new Error(`postMessage failed: ${posted.error.code}`);
    await repository.save(thread);
  });

const openDm = async (t: T, bob: Id<"users">) =>
  asAlice(t).mutation(api.conversation.openDmThread.openDmThread, {
    recipientId: bob,
  });

describe("media messages through the read models", () => {
  test("the thread view returns kind, caption and attachmentId; the inbox the caption and no ref", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seed(t);
    const threadId = await openDm(t, bob);
    await postMedia(t, alice, threadId, "image", "look at this", "att-1");

    const messages = await asBob(t).query(
      api.conversation.getThreadMessages.getThreadMessages,
      { threadId },
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      kind: "image",
      body: "look at this",
      attachmentId: "att-1",
    });

    const [inbox] = await asBob(t).query(
      api.conversation.getMyInbox.getMyInbox,
      {},
    );
    expect(inbox?.lastMessage).toMatchObject({
      kind: "image",
      body: "look at this",
    });
    expect(inbox?.lastMessage).not.toHaveProperty("attachmentId");
    expect(inbox?.unreadCount).toBe(1);
  });

  test("the inbox fallback (no lastMessage summary yet) summarises a location without its ref", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seed(t);
    const threadId = await openDm(t, bob);
    await postMedia(t, alice, threadId, "location", "", "att-2");
    await t.run(async (ctx) => {
      const thread = await ctx.db
        .query("threads")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", threadId))
        .unique();
      if (thread) await ctx.db.patch(thread._id, { lastMessage: undefined });
    });

    const [inbox] = await asBob(t).query(
      api.conversation.getMyInbox.getMyInbox,
      {},
    );
    expect(inbox?.lastMessage).toMatchObject({ kind: "location", body: "" });
    expect(inbox?.lastMessage).not.toHaveProperty("attachmentId");
  });
});

describe("postMessage stays text-only for clients", () => {
  test.each(["image", "location"])(
    "a hand-crafted %s post is refused by the argument validator and nothing is stored",
    async (kind) => {
      const t = convexTest(schema, modules);
      const { bob } = await seed(t);
      const threadId = await openDm(t, bob);
      const args = { threadId, kind, body: "" } as unknown as {
        threadId: string;
        kind: "text";
        body: string;
      };
      await expect(
        asAlice(t).mutation(api.conversation.postMessage.postMessage, args),
      ).rejects.toThrow(new RegExp(`Expected \`text\`, got \`${kind}\``));
      const rows = await t.run((ctx) =>
        ctx.db
          .query("threadMessages")
          .withIndex("by_thread_sent", (q) =>
            q.eq("threadAggregateId", threadId),
          )
          .collect(),
      );
      expect(rows).toHaveLength(0);
    },
  );

  test("a client cannot smuggle an attachment onto a text post", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    const threadId = await openDm(t, bob);
    const args = {
      threadId,
      kind: "text",
      body: "hi",
      attachmentId: "att-1",
    } as unknown as { threadId: string; kind: "text"; body: string };
    await expect(
      asAlice(t).mutation(api.conversation.postMessage.postMessage, args),
    ).rejects.toThrow(/attachmentId/);
  });
});

// The domain refuses media without an attachment, so internal callers cannot write a new
// attachment-less image row either.
test("the aggregate refuses an image without an attachment", () => {
  const thread = Thread.openDm(toThreadId("t"), [alice, toMemberId("bob")]);
  if (!thread.isOk) throw new Error("openDm failed");
  const posted = thread.value.postMessage({
    id: toMessageId("m"),
    authorId: alice,
    kind: "image",
    body: "https://evil.example/x.png",
    sentAt: new Date(),
  });
  expect(posted.isErr && posted.error.code).toBe("AttachmentRequired");
});
