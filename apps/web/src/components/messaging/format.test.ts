import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";
import type { InboxThread } from "./format";
import {
  conversationErrorCode,
  formatUnreadCount,
  threadSubjectTitle,
} from "./format";

// Deterministic translator stub: bare key when no values, key + values when
// interpolating — enough to assert both the key chosen and what was passed.
const t = (key: string, values?: Record<string, string | number>) =>
  values ? `${key}:${Object.values(values).join("|")}` : key;

describe("conversationErrorCode", () => {
  it("extracts the code from a ConvexError carrying one", () => {
    expect(
      conversationErrorCode(new ConvexError({ code: "MessageTooLong" })),
    ).toBe("MessageTooLong");
  });

  it("yields nothing for a non-ConvexError rejection", () => {
    expect(conversationErrorCode(new Error("boom"))).toBeUndefined();
  });
});

describe("formatUnreadCount", () => {
  it("renders counts below the cap verbatim", () => {
    expect(formatUnreadCount(1)).toBe("1");
    expect(formatUnreadCount(49)).toBe("49");
  });

  it('renders the capped value 50 as "50+" (50 means "50 or more")', () => {
    expect(formatUnreadCount(50)).toBe("50+");
  });

  it('renders anything above the cap as "50+" too', () => {
    expect(formatUnreadCount(120)).toBe("50+");
  });
});

describe("threadSubjectTitle", () => {
  it("uses the revealed member's name for a DM", () => {
    const subject = {
      kind: "dm",
      otherMember: { anonymous: false, member: { name: "Alice Johnson" } },
    } as InboxThread["subject"];
    expect(threadSubjectTitle(subject, t)).toBe("Alice Johnson");
  });

  it("uses the anonymous label for an anonymised DM partner — never an id", () => {
    const subject = {
      kind: "dm",
      otherMember: { anonymous: true, anonRef: "anon-123" },
    } as InboxThread["subject"];
    expect(threadSubjectTitle(subject, t)).toBe("anonymous");
  });

  it("titles an exchange thread with its type and puzzle title", () => {
    const subject = {
      kind: "exchange",
      exchangeId: "ex-1",
      exchangeType: "trade",
      puzzleTitle: "Neuschwanstein Castle",
    } as InboxThread["subject"];
    expect(threadSubjectTitle(subject, t)).toBe(
      "exchangeThread:exchangeType.trade|Neuschwanstein Castle",
    );
  });

  it("falls back to the untitled label when the puzzle title is unresolved", () => {
    const subject = {
      kind: "exchange",
      exchangeId: "ex-1",
      exchangeType: "loan",
      puzzleTitle: null,
    } as InboxThread["subject"];
    expect(threadSubjectTitle(subject, t)).toBe(
      "exchangeThread:exchangeType.loan|untitledPuzzle",
    );
  });
});
