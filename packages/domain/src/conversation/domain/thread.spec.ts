import { describe, expect, it } from "vitest";
import {
  toCircleId,
  toCopyId,
  toExchangeId,
  toMemberId,
  toMessageId,
  toThreadId,
} from "../../shared-kernel";
import { MAX_CAPTION_LENGTH, MAX_MESSAGE_LENGTH } from "./errors";
import { MessagePosted, ParticipantJoined, ParticipantLeft } from "./events";
import { MemberId, MessageId, ThreadId } from "./ids";
import { SYSTEM_EVENT_BODY, TRADE_EVENT_BODY } from "./message";
import { Thread, ThreadSubject } from "./thread";

const alice = toMemberId("alice");
const bob = toMemberId("bob");
const carol = toMemberId("carol"); // outsider
const exchangeId = toExchangeId("ex-1");
const threadId = toThreadId("thread-1");
const msg1 = toMessageId("message-1");
const msg2 = toMessageId("message-2");
const NOW = new Date("2026-06-08T10:00:00Z");
const LATER = new Date("2026-06-08T11:00:00Z");

const openThread = () =>
  Thread.openForExchange(threadId, exchangeId, [alice, bob]);

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
      subject: ThreadSubject;
      authorId: MemberId | null;
      messageId: MessageId;
      kind: string;
    };
    expect(posted.threadId).toBe(threadId);
    expect(posted.subject).toEqual({ kind: "exchange", exchangeId });
    expect(posted.authorId).toBe(alice);
    expect(posted.messageId).toBe(msg1);
    expect(posted.kind).toBe("text");
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

  it("rejects a whitespace-only body", () => {
    const thread = openThread();

    const result = thread.postMessage({
      id: msg1,
      authorId: alice,
      kind: "text",
      body: " \n\t ",
      sentAt: NOW,
    });

    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("EmptyMessage");
    expect(thread.messages).toHaveLength(0);
  });

  it("stores the body as-given (trim is only for the emptiness check)", () => {
    const thread = openThread();

    const result = thread.postMessage({
      id: msg1,
      authorId: alice,
      kind: "text",
      body: "  padded  ",
      sentAt: NOW,
    });

    expect(result.isOk).toBe(true);
    if (result.isOk) expect(result.value.body).toBe("  padded  ");
  });

  it("rejects a body longer than MAX_MESSAGE_LENGTH with MessageTooLong", () => {
    const thread = openThread();

    const result = thread.postMessage({
      id: msg1,
      authorId: alice,
      kind: "text",
      body: "x".repeat(MAX_MESSAGE_LENGTH + 1),
      sentAt: NOW,
    });

    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("MessageTooLong");
    expect(thread.messages).toHaveLength(0);
  });

  it("accepts a body of exactly MAX_MESSAGE_LENGTH", () => {
    const thread = openThread();

    const result = thread.postMessage({
      id: msg1,
      authorId: alice,
      kind: "text",
      body: "x".repeat(MAX_MESSAGE_LENGTH),
      sentAt: NOW,
    });

    expect(result.isOk).toBe(true);
    expect(thread.messages).toHaveLength(1);
  });

  it("keeps messages in send order", () => {
    const thread = openThread();
    thread.postMessage({
      id: msg1,
      authorId: alice,
      kind: "text",
      body: "first",
      sentAt: NOW,
    });
    thread.postMessage({
      id: msg2,
      authorId: bob,
      kind: "text",
      body: "second",
      sentAt: LATER,
    });

    expect(thread.messages.map((m) => m.id)).toEqual([msg1, msg2]);
  });

  it("drains events only once", () => {
    const thread = openThread();
    thread.postMessage({
      id: msg1,
      authorId: alice,
      kind: "text",
      body: "hi",
      sentAt: NOW,
    });
    expect(thread.pullEvents()).toHaveLength(1);
    expect(thread.pullEvents()).toHaveLength(0);
  });

  it("carries an optional copy reference onto the message (absent by default)", () => {
    const thread = openThread();
    const copyId = toCopyId("copy-1");

    const about = thread.postMessage({
      id: msg1,
      authorId: alice,
      kind: "text",
      body: "is this still available?",
      sentAt: NOW,
      copyId,
    });
    const plain = thread.postMessage({
      id: msg2,
      authorId: bob,
      kind: "text",
      body: "yes",
      sentAt: LATER,
    });

    expect(about.isOk && about.value.copyId).toBe(copyId);
    expect(plain.isOk && plain.value.copyId).toBeUndefined();
    expect(thread.toState().messages[0]?.copyId).toBe(copyId);
  });
});

describe("Thread.postMessage text vs media rules", () => {
  it("rejects a text message that carries an attachment", () => {
    const thread = openThread();

    const result = thread.postMessage({
      id: msg1,
      authorId: alice,
      kind: "text",
      body: "hello",
      sentAt: NOW,
      attachmentRef: "att-1",
    });

    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("AttachmentNotAllowed");
    expect(thread.messages).toHaveLength(0);
    expect(thread.pullEvents()).toHaveLength(0);
  });

  it.each(["image", "location"] as const)(
    "appends a %s message with its attachment and caption, recording MessagePosted with the kind",
    (kind) => {
      const thread = openThread();

      const result = thread.postMessage({
        id: msg1,
        authorId: bob,
        kind,
        body: "the meeting spot",
        sentAt: NOW,
        attachmentRef: "att-1",
      });

      expect(result.isOk).toBe(true);
      if (!result.isOk) return;
      expect(result.value.kind).toBe(kind);
      expect(result.value.body).toBe("the meeting spot");
      expect(result.value.attachmentRef).toBe("att-1");
      expect(thread.toState().messages[0]?.attachmentRef).toBe("att-1");
      const events = thread.pullEvents();
      expect(events.map((e) => e.name)).toEqual(["MessagePosted"]);
      expect((events[0] as unknown as { kind: string }).kind).toBe(kind);
    },
  );

  it.each(["image", "location"] as const)(
    "accepts a %s message with an empty caption",
    (kind) => {
      const thread = openThread();

      const result = thread.postMessage({
        id: msg1,
        authorId: bob,
        kind,
        body: "",
        sentAt: NOW,
        attachmentRef: "att-1",
      });

      expect(result.isOk).toBe(true);
      if (result.isOk) expect(result.value.body).toBe("");
    },
  );

  it.each([
    ["image", undefined],
    ["image", ""],
    ["location", undefined],
    ["location", "  "],
  ] as const)(
    "rejects a %s message without an attachment (ref %j) with AttachmentRequired",
    (kind, attachmentRef) => {
      const thread = openThread();

      const result = thread.postMessage({
        id: msg1,
        authorId: bob,
        kind,
        body: "caption",
        sentAt: NOW,
        ...(attachmentRef !== undefined && { attachmentRef }),
      });

      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("AttachmentRequired");
      expect(thread.messages).toHaveLength(0);
      expect(thread.pullEvents()).toHaveLength(0);
    },
  );

  it("accepts a caption of exactly MAX_CAPTION_LENGTH", () => {
    const thread = openThread();

    const result = thread.postMessage({
      id: msg1,
      authorId: bob,
      kind: "image",
      body: "c".repeat(MAX_CAPTION_LENGTH),
      sentAt: NOW,
      attachmentRef: "att-1",
    });

    expect(result.isOk).toBe(true);
  });

  it("rejects a caption longer than MAX_CAPTION_LENGTH with CaptionTooLong (not MessageTooLong)", () => {
    const thread = openThread();

    const result = thread.postMessage({
      id: msg1,
      authorId: bob,
      kind: "location",
      body: "c".repeat(MAX_CAPTION_LENGTH + 1),
      sentAt: NOW,
      attachmentRef: "att-1",
    });

    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("CaptionTooLong");
    expect(thread.messages).toHaveLength(0);
  });

  it("still applies the text limit to text: a body over MAX_CAPTION_LENGTH is fine", () => {
    const thread = openThread();

    const result = thread.postMessage({
      id: msg1,
      authorId: alice,
      kind: "text",
      body: "t".repeat(MAX_CAPTION_LENGTH + 1),
      sentAt: NOW,
    });

    expect(result.isOk).toBe(true);
    if (result.isOk) expect(result.value.attachmentRef).toBeUndefined();
  });

  it("rejects a media post from a non-participant before checking the attachment", () => {
    const thread = openThread();

    const result = thread.postMessage({
      id: msg1,
      authorId: carol,
      kind: "image",
      body: "",
      sentAt: NOW,
    });

    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("NotParticipant");
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

  it("carries a trade lifecycle row's structured tradeEvent", () => {
    const thread = openThread();

    const result = thread.postSystemMessage({
      id: msg1,
      body: TRADE_EVENT_BODY.accepted,
      sentAt: NOW,
      tradeEvent: { kind: "accepted" },
    });

    expect(result.isOk).toBe(true);
    if (!result.isOk) return;
    expect(result.value.tradeEvent).toEqual({ kind: "accepted" });
    expect(result.value.body).toBe("exchange_accepted");
  });

  it("rejects an empty system body", () => {
    const thread = openThread();
    const result = thread.postSystemMessage({
      id: msg1,
      body: "",
      sentAt: NOW,
    });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("EmptyMessage");
  });

  it("rejects a whitespace-only system body", () => {
    const thread = openThread();
    const result = thread.postSystemMessage({
      id: msg1,
      body: "   ",
      sentAt: NOW,
    });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("EmptyMessage");
  });

  it("rejects an over-long system body with MessageTooLong", () => {
    const thread = openThread();
    const result = thread.postSystemMessage({
      id: msg1,
      body: "x".repeat(MAX_MESSAGE_LENGTH + 1),
      sentAt: NOW,
    });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("MessageTooLong");
  });

  it("accepts a system body of exactly MAX_MESSAGE_LENGTH", () => {
    const thread = openThread();
    const result = thread.postSystemMessage({
      id: msg1,
      body: "x".repeat(MAX_MESSAGE_LENGTH),
      sentAt: NOW,
    });
    expect(result.isOk).toBe(true);
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

describe("Thread subjects", () => {
  it("openForExchange yields an exchange-subject thread", () => {
    const thread = Thread.openForExchange(threadId, exchangeId, [alice, bob]);
    expect(thread.subject).toEqual({ kind: "exchange", exchangeId });
  });

  it("openDm yields a dm-subject thread with exactly two participants", () => {
    const result = Thread.openDm(threadId, [alice, bob]);
    expect(result.isOk).toBe(true);
    if (result.isOk) {
      expect(result.value.subject).toEqual({ kind: "dm" });
      expect(result.value.participants).toEqual([alice, bob]);
    }
  });

  it("openDm rejects duplicate participants", () => {
    const result = Thread.openDm(threadId, [alice, alice]);
    expect(result.isErr).toBe(true);
    if (result.isErr)
      expect(result.error.code).toBe("DmRequiresTwoParticipants");
  });

  it("MessagePosted carries the subject", () => {
    const result = Thread.openDm(threadId, [alice, bob]);
    expect(result.isOk).toBe(true);
    if (!result.isOk) return;
    const thread = result.value;
    thread.postMessage({
      id: msg1,
      authorId: alice,
      kind: "text",
      body: "hi",
      sentAt: NOW,
    });
    const [event] = thread.pullEvents() as readonly MessagePosted[];
    expect(event.subject).toEqual({ kind: "dm" });
  });
});

describe("Thread persistence", () => {
  it("round-trips messages and receipts through toState/rehydrate", () => {
    const thread = openThread();
    thread.postMessage({
      id: msg1,
      authorId: alice,
      kind: "text",
      body: "hi",
      sentAt: NOW,
    });
    thread.markRead(bob, NOW);

    const rehydrated = Thread.rehydrate(thread.toState());

    expect(rehydrated.id).toBe(threadId);
    expect(rehydrated.subject).toEqual({ kind: "exchange", exchangeId });
    expect(rehydrated.messages.map((m) => m.id)).toEqual([msg1]);
    expect(rehydrated.lastReadAt(bob)).toEqual(NOW);
    // Rehydration does not re-emit events.
    expect(rehydrated.pullEvents()).toHaveLength(0);
  });

  it("round-trips a dm-subject thread through toState/rehydrate", () => {
    const result = Thread.openDm(threadId, [alice, bob]);
    expect(result.isOk).toBe(true);
    if (!result.isOk) return;

    const rehydrated = Thread.rehydrate(result.value.toState());

    expect(rehydrated.subject).toEqual({ kind: "dm" });
    expect(rehydrated.participants).toEqual([alice, bob]);
  });
});

describe("Thread circle subject", () => {
  const circleId = toCircleId("circle-1");
  const T0 = new Date("2026-06-08T09:00:00Z");
  const T1 = new Date("2026-06-08T09:30:00Z");

  const openCircle = () => {
    const result = Thread.openForCircle(threadId, circleId, [
      { memberId: alice, joinedAt: T0 },
      { memberId: bob, joinedAt: T1 },
    ]);
    if (!result.isOk) throw new Error("expected a circle thread");
    return result.value;
  };

  const openPairs = () => {
    const dm = Thread.openDm(threadId, [alice, bob]);
    if (!dm.isOk) throw new Error("expected a dm thread");
    return [openThread(), dm.value];
  };

  describe("openForCircle", () => {
    it("opens a circle-subject thread seeded with the members and their joinedAt", () => {
      const thread = openCircle();

      expect(thread.subject).toEqual({ kind: "circle", circleId });
      expect(thread.participants).toEqual([alice, bob]);
      expect(thread.visibleFrom(alice)).toEqual(T0);
      expect(thread.visibleFrom(bob)).toEqual(T1);
      expect(thread.messages).toHaveLength(0);
      expect(thread.readReceipts).toHaveLength(0);
      expect(thread.pullEvents()).toHaveLength(0);
    });

    it("allows a single participant (a circle with only its owner)", () => {
      const result = Thread.openForCircle(threadId, circleId, [
        { memberId: alice, joinedAt: T0 },
      ]);

      expect(result.isOk).toBe(true);
      if (result.isOk) expect(result.value.participants).toEqual([alice]);
    });

    it("rejects an empty roster with CircleThreadRequiresParticipant", () => {
      const result = Thread.openForCircle(threadId, circleId, []);

      expect(result.isErr).toBe(true);
      if (result.isErr)
        expect(result.error.code).toBe("CircleThreadRequiresParticipant");
    });

    it("keeps a member listed twice once, with its first joinedAt", () => {
      const result = Thread.openForCircle(threadId, circleId, [
        { memberId: alice, joinedAt: T0 },
        { memberId: bob, joinedAt: T0 },
        { memberId: alice, joinedAt: T1 },
      ]);

      expect(result.isOk).toBe(true);
      if (!result.isOk) return;
      expect(result.value.participants).toEqual([alice, bob]);
      expect(result.value.visibleFrom(alice)).toEqual(T0);
    });
  });

  describe("addParticipant", () => {
    it("adds a new member with joinedAt = now and records ParticipantJoined", () => {
      const thread = openCircle();

      const result = thread.addParticipant(carol, NOW);

      expect(result.isOk && result.value).toBe(true);
      expect(thread.participants).toEqual([alice, bob, carol]);
      expect(thread.visibleFrom(carol)).toEqual(NOW);
      const [event] = thread.pullEvents() as readonly ParticipantJoined[];
      expect(event).toBeInstanceOf(ParticipantJoined);
      expect(event.name).toBe("ParticipantJoined");
      expect(event.threadId).toBe(threadId);
      expect(event.subject).toEqual({ kind: "circle", circleId });
      expect(event.memberId).toBe(carol);
      expect(event.occurredAt).toEqual(NOW);
    });

    it("is idempotent for a current participant: no change, joinedAt kept, no event", () => {
      const thread = openCircle();

      const result = thread.addParticipant(alice, NOW);

      expect(result.isOk).toBe(true);
      if (result.isOk) expect(result.value).toBe(false);
      expect(thread.participants).toEqual([alice, bob]);
      expect(thread.visibleFrom(alice)).toEqual(T0);
      expect(thread.pullEvents()).toHaveLength(0);
    });

    it("a re-join after leaving sets a fresh joinedAt", () => {
      const thread = openCircle();
      thread.removeParticipant(alice, NOW);

      const result = thread.addParticipant(alice, LATER);

      expect(result.isOk && result.value).toBe(true);
      expect(thread.visibleFrom(alice)).toEqual(LATER);
      expect(thread.canSee(alice, NOW)).toBe(false);
    });

    it("rejects ParticipantsFixed on exchange and DM threads, changing nothing", () => {
      for (const thread of openPairs()) {
        const result = thread.addParticipant(carol, NOW);

        expect(result.isErr).toBe(true);
        if (result.isErr) expect(result.error.code).toBe("ParticipantsFixed");
        expect(thread.participants).toEqual([alice, bob]);
        expect(thread.pullEvents()).toHaveLength(0);
      }
    });
  });

  describe("removeParticipant", () => {
    it("removes the member, drops their receipt only, and records ParticipantLeft", () => {
      const thread = openCircle();
      thread.markRead(alice, NOW);
      thread.markRead(bob, NOW);

      const result = thread.removeParticipant(bob, LATER);

      expect(result.isOk && result.value).toBe(true);
      expect(thread.participants).toEqual([alice]);
      expect(thread.lastReadAt(bob)).toBeNull();
      expect(thread.lastReadAt(alice)).toEqual(NOW);
      const [event] = thread.pullEvents() as readonly ParticipantLeft[];
      expect(event).toBeInstanceOf(ParticipantLeft);
      expect(event.name).toBe("ParticipantLeft");
      expect(event.threadId).toBe(threadId);
      expect(event.subject).toEqual({ kind: "circle", circleId });
      expect(event.memberId).toBe(bob);
      expect(event.occurredAt).toEqual(LATER);
    });

    it("a removed member can no longer post or see the thread", () => {
      const thread = openCircle();
      thread.removeParticipant(bob, NOW);

      const posted = thread.postMessage({
        id: msg1,
        authorId: bob,
        kind: "text",
        body: "still here?",
        sentAt: LATER,
      });

      expect(posted.isErr).toBe(true);
      if (posted.isErr) expect(posted.error.code).toBe("NotParticipant");
      expect(thread.canSee(bob, LATER)).toBe(false);
    });

    it("removing a non-participant is a no-op: no change, no event", () => {
      const thread = openCircle();

      const result = thread.removeParticipant(carol, NOW);

      expect(result.isOk).toBe(true);
      if (result.isOk) expect(result.value).toBe(false);
      expect(thread.participants).toEqual([alice, bob]);
      expect(thread.pullEvents()).toHaveLength(0);
    });

    it("rejects ParticipantsFixed on exchange and DM threads, changing nothing", () => {
      for (const thread of openPairs()) {
        const result = thread.removeParticipant(bob, NOW);

        expect(result.isErr).toBe(true);
        if (result.isErr) expect(result.error.code).toBe("ParticipantsFixed");
        expect(thread.participants).toEqual([alice, bob]);
        expect(thread.pullEvents()).toHaveLength(0);
      }
    });
  });

  describe("history visibility", () => {
    it("hides a message sent exactly at joinedAt (strict floor) and shows one just after", () => {
      const thread = openCircle();

      expect(thread.canSee(bob, T1)).toBe(false);
      expect(thread.canSee(bob, new Date(T1.getTime() + 1))).toBe(true);
      expect(thread.canSee(bob, T0)).toBe(false);
      expect(thread.canSee(alice, T1)).toBe(true);
    });

    it("hides everything from a non-participant", () => {
      expect(openCircle().canSee(carol, LATER)).toBe(false);
      expect(openThread().canSee(carol, LATER)).toBe(false);
      expect(openThread().visibleFrom(carol)).toBeNull();
      expect(openCircle().visibleFrom(carol)).toBeNull();
    });

    it("has no floor on exchange and DM threads", () => {
      for (const thread of openPairs()) {
        expect(thread.visibleFrom(alice)).toBeNull();
        expect(thread.canSee(alice, new Date(0))).toBe(true);
      }
    });

    it("ignores a joinedAt stored on an exchange or DM participant", () => {
      const thread = Thread.rehydrate({
        id: threadId,
        subject: { kind: "dm" },
        participants: [
          { memberId: alice, joinedAt: LATER },
          { memberId: bob, joinedAt: LATER },
        ],
        messages: [],
        readReceipts: [],
      });

      expect(thread.visibleFrom(alice)).toBeNull();
      expect(thread.canSee(alice, NOW)).toBe(true);
    });

    it("has no floor for a circle participant stored without joinedAt (legacy)", () => {
      const thread = Thread.rehydrate({
        id: threadId,
        subject: { kind: "circle", circleId },
        participants: [{ memberId: alice }],
        messages: [],
        readReceipts: [],
      });

      expect(thread.visibleFrom(alice)).toBeNull();
      expect(thread.canSee(alice, new Date(0))).toBe(true);
    });
  });

  describe("join/leave system messages", () => {
    it("carries the systemEvent on a circle thread's system message", () => {
      const thread = openCircle();

      const result = thread.postSystemMessage({
        id: msg1,
        body: SYSTEM_EVENT_BODY.joined,
        sentAt: NOW,
        systemEvent: { kind: "joined", memberId: carol },
      });

      expect(result.isOk).toBe(true);
      if (!result.isOk) return;
      expect(result.value.kind).toBe("system");
      expect(result.value.body).toBe("member_joined");
      expect(result.value.systemEvent).toEqual({
        kind: "joined",
        memberId: carol,
      });
      expect(thread.toState().messages[0]?.systemEvent).toEqual({
        kind: "joined",
        memberId: carol,
      });
      expect(thread.pullEvents().map((e) => e.name)).toEqual(["MessagePosted"]);
    });

    it("leaves systemEvent absent on a plain system message", () => {
      const thread = openCircle();

      thread.postSystemMessage({ id: msg1, body: "hello", sentAt: NOW });

      expect(thread.toState().messages[0]).not.toHaveProperty("systemEvent");
    });

    it("rejects a systemEvent on exchange and DM threads with ParticipantsFixed", () => {
      for (const thread of openPairs()) {
        const result = thread.postSystemMessage({
          id: msg1,
          body: SYSTEM_EVENT_BODY.left,
          sentAt: NOW,
          systemEvent: { kind: "left", memberId: bob },
        });

        expect(result.isErr).toBe(true);
        if (result.isErr) expect(result.error.code).toBe("ParticipantsFixed");
        expect(thread.messages).toHaveLength(0);
        expect(thread.pullEvents()).toHaveLength(0);
      }
    });

    it("still applies the body rule to a join/leave message", () => {
      const result = openCircle().postSystemMessage({
        id: msg1,
        body: "",
        sentAt: NOW,
        systemEvent: { kind: "left", memberId: bob },
      });

      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("EmptyMessage");
    });
  });

  it("round-trips a circle thread with joinedAt through toState/rehydrate", () => {
    const rehydrated = Thread.rehydrate(openCircle().toState());

    expect(rehydrated.subject).toEqual({ kind: "circle", circleId });
    expect(rehydrated.participants).toEqual([alice, bob]);
    expect(rehydrated.visibleFrom(bob)).toEqual(T1);
  });

  it("stores exchange and DM participants without a joinedAt", () => {
    for (const thread of openPairs()) {
      expect(thread.toState().participants).toEqual([
        { memberId: alice },
        { memberId: bob },
      ]);
    }
  });
});
