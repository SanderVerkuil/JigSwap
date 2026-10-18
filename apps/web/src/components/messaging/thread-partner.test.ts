import { describe, expect, it } from "vitest";
import type { InboxThread } from "./format";
import { threadPartner } from "./thread-partner";

const mara = {
  _id: "member_mara",
  _creationTime: 0,
  name: "Mara",
  isActive: true,
  createdAt: 0,
  updatedAt: 0,
};

const thread = (subject: InboxThread["subject"]): InboxThread => ({
  threadId: "thread_1",
  subject,
  lastMessage: null,
  unreadCount: 0,
  contextCopies: [],
  updatedAt: 0,
});

describe("threadPartner", () => {
  it("is the revealed member of a DM", () => {
    expect(
      threadPartner(
        thread({
          kind: "dm",
          otherMember: { anonymous: false, member: mara },
          profileHandle: "mara",
        }),
      ),
    ).toBe(mara);
  });

  it("is the revealed trading partner of an exchange thread", () => {
    expect(
      threadPartner(
        thread({
          kind: "exchange",
          exchangeId: "exchange_1",
          exchangeType: "loan",
          puzzleTitle: null,
          otherMember: { anonymous: false, member: mara },
          profileHandle: "mara",
        }),
      ),
    ).toBe(mara);
  });

  it("is null for an anonymised partner", () => {
    expect(
      threadPartner(
        thread({
          kind: "exchange",
          exchangeId: "exchange_1",
          exchangeType: "trade",
          puzzleTitle: null,
          otherMember: { anonymous: true, anonRef: "anon_1" },
          profileHandle: null,
        }),
      ),
    ).toBeNull();
  });
});
