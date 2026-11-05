// UX-114: whom the inbox's "Message a member" picker offers.
import { describe, expect, it } from "vitest";
import { dmCandidates, type FollowEdge } from "./dm-candidates";
import type { AnyInboxThread } from "./format";

const member = (id: string, name: string, extra: { avatar?: string } = {}) => ({
  _id: id,
  _creationTime: 0,
  name,
  isActive: true,
  createdAt: 0,
  updatedAt: 0,
  ...extra,
});

const base = (threadId: string) => ({
  threadId,
  lastMessage: null,
  unreadCount: 0,
  contextCopies: [],
  updatedAt: 1,
});

const dm = (
  threadId: string,
  partner: ReturnType<typeof member>,
  extra: Partial<Pick<AnyInboxThread, "blocked" | "readOnly">> = {},
): AnyInboxThread => ({
  ...base(threadId),
  ...extra,
  subject: {
    kind: "dm",
    otherMember: { anonymous: false, member: partner },
    profileHandle: threadId,
  },
});

const exchange = (
  threadId: string,
  partner: ReturnType<typeof member>,
): AnyInboxThread => ({
  ...base(threadId),
  subject: {
    kind: "exchange",
    exchangeId: `ex_${threadId}`,
    exchangeType: "trade",
    puzzleTitle: "Night Harbour",
    otherMember: { anonymous: false, member: partner },
    profileHandle: null,
  },
});

const edge = (memberId: string, displayName?: string): FollowEdge => ({
  followId: `f_${memberId}`,
  memberId,
  displayName,
  createdAt: 0,
});

const mara = member("u_mara", "Mara", { avatar: "https://img/mara.png" });
const dirk = member("u_dirk", "Dirk");

describe("dmCandidates", () => {
  it("lists DM and exchange partners as Recent, in inbox order, each once", () => {
    const { recent } = dmCandidates(
      [
        dm("t1", mara),
        exchange("t2", dirk),
        exchange("t3", mara),
        {
          ...base("t4"),
          subject: {
            kind: "circle",
            circleId: "c1",
            name: "Puzzle Club",
            memberCount: 3,
            memberPreview: [],
          },
        },
      ],
      [],
      [],
    );
    expect(recent).toEqual([
      { memberId: "u_mara", name: mara, avatar: "https://img/mara.png" },
      { memberId: "u_dirk", name: dirk, avatar: undefined },
    ]);
  });

  it("leaves out anonymised, inactive, blocked and read-only partners", () => {
    const { recent } = dmCandidates(
      [
        {
          ...base("anon"),
          subject: {
            kind: "dm",
            otherMember: { anonymous: true, anonRef: "a1" },
            profileHandle: null,
          },
        },
        dm("gone", { ...member("u_gone", "Gone"), isActive: false }),
        dm("blocked", member("u_bas", "Bas"), { blocked: "byMe" }),
        dm("readonly", member("u_carla", "Carla"), { readOnly: true }),
      ],
      [],
      [],
    );
    expect(recent).toEqual([]);
  });

  it("lists mutual followers who are not Recent, by name, each once", () => {
    const { mutual } = dmCandidates(
      [dm("t1", mara)],
      [
        edge("u_mara", "Mara"),
        edge("u_zoe", "Zoë"),
        edge("u_eva", "Eva"),
        edge("u_eva", "Eva"),
        edge("u_femke", "Femke"),
        edge("u_anon"),
      ],
      [
        edge("u_mara", "Mara"),
        edge("u_zoe", "Zoë"),
        edge("u_eva", "Eva"),
        edge("u_gijs", "Gijs"),
        edge("u_anon"),
      ],
    );
    expect(mutual).toEqual([
      { memberId: "u_eva", name: { name: "Eva" } },
      { memberId: "u_zoe", name: { name: "Zoë" } },
      { memberId: "u_anon", name: { name: undefined } },
    ]);
  });
});
