import { describe, expect, it } from "vitest";
import { leaveConsequence } from "./switch-household-dialog";

type Current = Parameters<typeof leaveConsequence>[0];

const member = (
  memberId: string,
  role: "admin" | "member",
  joinedAt: number,
  isYou = false,
) => ({ memberId, name: memberId, role, joinedAt, isYou });

const household = (
  viewerRole: "admin" | "member",
  members: Current["members"],
): Current => ({
  householdId: "hh",
  viewerRole,
  members,
  pendingInvites: [],
  defaultCopyPermission: "manage",
  copiesUsingDefault: 0,
});

// Mirrors the server's leave rules (Household.leave / drop), which the switch applies.
describe("leaveConsequence", () => {
  it("the only member's household is deleted", () => {
    expect(
      leaveConsequence(household("admin", [member("me", "admin", 1, true)])),
    ).toEqual({ kind: "deleted" });
  });

  it("an admin leaving housemates hands over to the longest-standing one", () => {
    const result = leaveConsequence(
      household("admin", [
        member("me", "admin", 1, true),
        member("late", "member", 30),
        member("early", "member", 10),
      ]),
    );
    expect(result.kind === "handover" && result.nextAdmin.memberId).toBe(
      "early",
    );
  });

  it("a plain member just leaves", () => {
    expect(
      leaveConsequence(
        household("member", [
          member("admin", "admin", 1),
          member("me", "member", 2, true),
        ]),
      ),
    ).toEqual({ kind: "leave" });
  });
});
