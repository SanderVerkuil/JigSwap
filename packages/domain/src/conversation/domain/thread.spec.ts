import { describe, expect, it } from "vitest";
import { toId } from "../../shared-kernel";
import { ExchangeId, MemberId, MessageId, ThreadId } from "./ids";
import { Thread } from "./thread";

const alice = toId<"MemberId">("alice") as MemberId;
const bob = toId<"MemberId">("bob") as MemberId;
const carol = toId<"MemberId">("carol") as MemberId; // outsider
const exchangeId = toId<"ExchangeId">("ex-1") as ExchangeId;
const threadId = toId<"ThreadId">("thread-1") as ThreadId;
const msg1 = toId<"MessageId">("message-1") as MessageId;
const msg2 = toId<"MessageId">("message-2") as MessageId;
const NOW = new Date("2026-06-08T10:00:00Z");
const LATER = new Date("2026-06-08T11:00:00Z");

const openThread = () => Thread.open(threadId, exchangeId, [alice, bob]);

describe("Thread.postMessage", () => {
  it("appends a participant's text message and records MessagePosted", () => {
    const thread = openThread();

    const result = thread.postMessage({
      id: msg1,
      authorId: alice,
      kind: "text",
      body: "hello bob",
      sentAt: NOW,
    });

    expect(result.isOk).toBe(true);
    if (!result.isOk) return;
    expect(result.value.kind).toBe("text");
    expect(result.value.authorId).toBe(alice);
    expect(thread.messages).toHaveLength(1);

    const events = thread.pullEvents();
    expect(events.map((e) => e.name)).toEqual(["MessagePosted"]);
    const posted = events[0] as unknown as {
      threadId: ThreadId;
      exchangeId: ExchangeId;
      authorId: MemberId | null;
      messageId: MessageId;
      kind: string;
    };
    expect(posted.threadId).toBe(threadId);
    expect(posted.exchangeId).toBe(exchangeId);
    expect(posted.authorId).toBe(alice);
    expect(posted.messageId).toBe(msg1);
    expect(posted.kind).toBe("text");
  });

  it("treats an image body as a storage reference and accepts it", () => {
    const thread = openThread();

    const result = thread.postMessage({
      id: msg1,
      authorId: bob,
      kind: "image",
      body: "storage://abc",
      sentAt: NOW,
    });

    expect(result.isOk).toBe(true);
    if (result.isOk) expect(result.value.kind).toBe("image");
  });

  it("rejects a non-participant author and appends nothing", () => {
    const thread = openThread();

    const result = thread.postMessage({
      id: msg1,
      authorId: carol,
      kind: "text",
      body: "let me in",
      sentAt: NOW,
    });

    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("NotParticipant");
    expect(thread.messages).toHaveLength(0);
    expect(thread.pullEvents()).toHaveLength(0);
  });

  it("rejects an empty body", () => {
    const thread = openThread();

    const result = thread.postMessage({
      id: msg1,
      authorId: alice,
      kind: "text",
      body: "",
      sentAt: NOW,
    });

    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("EmptyMessage");
    expect(thread.messages).toHaveLength(0);
  });

  it("keeps messages in send order", () => {
    const thread = openThread();
    thread.postMessage({ id: msg1, authorId: alice, kind: "text", body: "first", sentAt: NOW });
    thread.postMessage({ id: msg2, authorId: bob, kind: "text", body: "second", sentAt: LATER });

    expect(thread.messages.map((m) => m.id)).toEqual([msg1, msg2]);
  });

  it("drains events only once", () => {
    const thread = openThread();
    thread.postMessage({ id: msg1, authorId: alice, kind: "text", body: "hi", sentAt: NOW });
    expect(thread.pullEvents()).toHaveLength(1);
    expect(thread.pullEvents()).toHaveLength(0);
  });
});

describe("Thread.postSystemMessage", () => {
  it("appends a service-authored system message with no member author", () => {
    const thread = openThread();

    const result = thread.postSystemMessage({
      id: msg1,
      body: "Exchange shipped",
      sentAt: NOW,
    });

    expect(result.isOk).toBe(true);
    if (!result.isOk) return;
    expect(result.value.kind).toBe("system");
    expect(result.value.authorId).toBeNull();

    const posted = thread.pullEvents()[0] as unknown as {
      authorId: MemberId | null;
      kind: string;
    };
    expect(posted.authorId).toBeNull();
    expect(posted.kind).toBe("system");
  });

  it("rejects an empty system body", () => {
    const thread = openThread();
    const result = thread.postSystemMessage({ id: msg1, body: "", sentAt: NOW });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("EmptyMessage");
  });
});

describe("Thread.markRead", () => {
  it("records the calling participant's read position", () => {
    const thread = openThread();

    const result = thread.markRead(alice, NOW);

    expect(result.isOk).toBe(true);
    expect(thread.lastReadAt(alice)).toEqual(NOW);
    expect(thread.lastReadAt(bob)).toBeNull();
  });

  it("updates only the caller's receipt, leaving others untouched", () => {
    const thread = openThread();
    thread.markRead(alice, NOW);
    thread.markRead(bob, NOW);

    thread.markRead(alice, LATER);

    expect(thread.lastReadAt(alice)).toEqual(LATER);
    expect(thread.lastReadAt(bob)).toEqual(NOW);
    // One receipt per participant, not a growing log.
    expect(thread.readReceipts).toHaveLength(2);
  });

  it("rejects a non-participant marking read", () => {
    const thread = openThread();
    const result = thread.markRead(carol, NOW);
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("NotParticipant");
    expect(thread.readReceipts).toHaveLength(0);
  });
});

describe("Thread persistence", () => {
  it("round-trips messages and receipts through toState/rehydrate", () => {
    const thread = openThread();
    thread.postMessage({ id: msg1, authorId: alice, kind: "text", body: "hi", sentAt: NOW });
    thread.markRead(bob, NOW);

    const rehydrated = Thread.rehydrate(thread.toState());

    expect(rehydrated.id).toBe(threadId);
    expect(rehydrated.exchangeId).toBe(exchangeId);
    expect(rehydrated.messages.map((m) => m.id)).toEqual([msg1]);
    expect(rehydrated.lastReadAt(bob)).toEqual(NOW);
    // Rehydration does not re-emit events.
    expect(rehydrated.pullEvents()).toHaveLength(0);
  });
});
