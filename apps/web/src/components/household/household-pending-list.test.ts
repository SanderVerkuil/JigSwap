import { describe, expect, it } from "vitest";
import { mergePendingInvites } from "./household-pending-list";

describe("mergePendingInvites", () => {
  it("lists in-app and email invitations together, newest first", () => {
    const rows = mergePendingInvites(
      [
        { inviteId: "i_old", invitee: { memberId: "u_cat" }, createdAt: 1 },
        { inviteId: "i_new", invitee: { memberId: "u_dan" }, createdAt: 4 },
      ],
      [
        { inviteRef: "e_mid", kind: "household", createdAt: 3, expiresAt: 10 },
        {
          inviteRef: "e_first",
          kind: "household",
          createdAt: 0,
          expiresAt: 10,
        },
      ],
    );
    expect(rows.map((row) => [row.kind, row.createdAt])).toEqual([
      ["inApp", 4],
      ["email", 3],
      ["inApp", 1],
      ["email", 0],
    ]);
  });

  it("adds open invite links in the same order", () => {
    const rows = mergePendingInvites(
      [{ inviteId: "i_1", invitee: { memberId: "u_cat" }, createdAt: 2 }],
      [],
      [
        { linkId: "l_new", createdAt: 5, expiresAt: 20 },
        { linkId: "l_old", createdAt: 1, expiresAt: 20 },
      ],
    );
    expect(rows.map((row) => row.kind)).toEqual(["link", "inApp", "link"]);
  });

  it("is empty when nothing is pending", () => {
    expect(mergePendingInvites([], [])).toEqual([]);
  });
});
