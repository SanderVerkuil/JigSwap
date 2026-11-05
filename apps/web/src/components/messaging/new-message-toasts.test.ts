import { describe, expect, it } from "vitest";
import type { AnyInboxThread } from "./format";
import { threadsToToast } from "./new-message-toasts";

type LastMessage = NonNullable<AnyInboxThread["lastMessage"]>;

const thread = (
  threadId: string,
  sentAt: number,
  message: Partial<LastMessage> = {},
  fields: Partial<AnyInboxThread> = {},
): AnyInboxThread => ({
  threadId,
  subject: {
    kind: "dm",
    otherMember: { anonymous: true, anonRef: `ref_${threadId}` },
    profileHandle: null,
  },
  lastMessage: {
    id: `${threadId}_${sentAt}`,
    isMine: false,
    kind: "text",
    body: "Hi",
    sentAt,
    ...message,
  },
  unreadCount: 1,
  contextCopies: [],
  updatedAt: sentAt,
  ...fields,
});

const ids = (threads: AnyInboxThread[]) => threads.map((t) => t.threadId);

const seenOf = (...entries: [string, number][]) => new Map(entries);

describe("threadsToToast", () => {
  it("stays quiet on the first look and remembers every thread", () => {
    const { toToast, seen } = threadsToToast(
      [thread("a", 300), thread("b", 200)],
      null,
      undefined,
    );
    expect(toToast).toEqual([]);
    expect(seen).toEqual(seenOf(["a", 300], ["b", 200]));
  });

  it("toasts a thread whose newest message advanced", () => {
    const { toToast } = threadsToToast(
      [thread("b", 400), thread("a", 300)],
      seenOf(["a", 300], ["b", 200]),
      undefined,
    );
    expect(ids(toToast)).toEqual(["b"]);
  });

  it("toasts a thread new to the page with a message newer than any seen", () => {
    const { toToast } = threadsToToast(
      [thread("c", 500), thread("a", 300)],
      seenOf(["a", 300], ["b", 200]),
      undefined,
    );
    expect(ids(toToast)).toEqual(["c"]);
  });

  it("stays quiet when an older thread slides into the page", () => {
    // "b" left the page (e.g. its exchange is gone); "z" moved up from below.
    const { toToast } = threadsToToast(
      [thread("a", 300), thread("z", 100)],
      seenOf(["a", 300], ["b", 200]),
      undefined,
    );
    expect(toToast).toEqual([]);
  });

  it("never toasts my own, system, muted, blocked-author or open-thread messages", () => {
    const previous = seenOf(["a", 1], ["b", 1], ["c", 1], ["d", 1], ["e", 1]);
    const { toToast } = threadsToToast(
      [
        thread("a", 10, { isMine: true }),
        thread("b", 10, { kind: "system" }),
        thread("c", 10, {}, { muted: true }),
        thread("d", 10, { authorBlockedByMe: true }),
        thread("e", 10),
      ],
      previous,
      "e",
    );
    expect(toToast).toEqual([]);
  });
});
