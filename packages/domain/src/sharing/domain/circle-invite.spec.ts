import { describe, expect, it } from "vitest";
import {
  toCircleId,
  toCircleInviteId,
  toMemberId,
  toMembershipId,
} from "../../shared-kernel";
import { Circle } from "./circle";
import {
  CIRCLE_INVITE_TTL_MS,
  CIRCLE_REINVITE_COOLDOWN_MS,
  CircleInvite,
} from "./circle-invite";
import {
  CircleInviteAccepted,
  CircleInviteDeclined,
  CircleInviteExpired,
  CircleInviteIssued,
  CircleInviteRevoked,
} from "./events";

const owner = toMemberId("owner");
const admin = toMemberId("admin");
const member = toMemberId("member");
const invitee = toMemberId("invitee");
const circleId = toCircleId("circle-1");
const inviteId = toCircleInviteId("invite-1");
const NOW = new Date("2026-06-08T10:00:00Z");
const at = (ms: number) => new Date(NOW.getTime() + ms);
const EXPIRES = at(CIRCLE_INVITE_TTL_MS);

const issue = (inviterId = owner) => {
  const result = CircleInvite.issue({
    id: inviteId,
    circleId,
    inviterId,
    inviteeId: invitee,
    permission: "Exchange",
    now: NOW,
  });
  if (!result.isOk) throw new Error("setup: issue failed");
  result.value.pullEvents();
  return result.value;
};

// owner (Admin), admin (Admin) and member (ViewOnly).
const circle = () => {
  const c = Circle.create({
    id: circleId,
    ownerId: owner,
    ownerMembershipId: toMembershipId("m-owner"),
    name: "Family",
    now: NOW,
  });
  c.addMember(owner, toMembershipId("m-admin"), admin, "Admin", NOW);
  c.addMember(owner, toMembershipId("m-member"), member, "ViewOnly", NOW);
  c.pullEvents();
  return c;
};

const codeOf = (result: { isErr: boolean; error?: { code: string } }) =>
  result.isErr ? result.error?.code : undefined;

describe("CircleInvite", () => {
  it("expires 14 days after it is issued", () => {
    expect(CIRCLE_INVITE_TTL_MS).toBe(14 * 24 * 60 * 60 * 1000);
  });

  describe("issue", () => {
    it("opens a pending invite and records CircleInviteIssued", () => {
      const result = CircleInvite.issue({
        id: inviteId,
        circleId,
        inviterId: owner,
        inviteeId: invitee,
        permission: "Exchange",
        now: NOW,
      });
      if (!result.isOk) throw new Error("expected ok");
      const invite = result.value;

      expect(invite.toState()).toEqual({
        id: inviteId,
        circleId,
        inviterId: owner,
        inviteeId: invitee,
        permission: "Exchange",
        status: "pending",
        createdAt: NOW,
        expiresAt: EXPIRES,
      });
      expect(invite.id).toBe(inviteId);
      expect(invite.circleId).toBe(circleId);
      expect(invite.inviterId).toBe(owner);
      expect(invite.inviteeId).toBe(invitee);
      expect(invite.permission).toBe("Exchange");
      expect(invite.status).toBe("pending");
      expect(invite.expiresAt).toEqual(EXPIRES);
      expect(invite.pullEvents()).toEqual([
        new CircleInviteIssued(
          inviteId,
          circleId,
          owner,
          invitee,
          EXPIRES,
          NOW,
        ),
      ]);
      expect(invite.pullEvents()).toEqual([]);
    });

    it("refuses inviting oneself", () => {
      const result = CircleInvite.issue({
        id: inviteId,
        circleId,
        inviterId: owner,
        inviteeId: owner,
        permission: "ViewOnly",
        now: NOW,
      });
      expect(codeOf(result)).toBe("CannotInvite");
    });
  });

  describe("isOpenAt", () => {
    it("is open while pending and before expiresAt, closed from expiresAt on", () => {
      const invite = issue();
      expect(invite.isOpenAt(at(CIRCLE_INVITE_TTL_MS - 1))).toBe(true);
      expect(invite.isOpenAt(EXPIRES)).toBe(false);
    });

    it("is closed once decided", () => {
      const invite = issue();
      invite.decline(invitee, NOW);
      expect(invite.isOpenAt(NOW)).toBe(false);
    });
  });

  describe("accept", () => {
    it("lets the invitee accept, recording CircleInviteAccepted", () => {
      const invite = issue();
      const later = at(1000);
      expect(invite.accept(invitee, later).isOk).toBe(true);
      expect(invite.status).toBe("accepted");
      expect(invite.toState().decidedAt).toEqual(later);
      expect(invite.pullEvents()).toEqual([
        new CircleInviteAccepted(inviteId, circleId, invitee, owner, later),
      ]);
    });

    it("refuses anyone but the invitee", () => {
      const invite = issue();
      expect(codeOf(invite.accept(owner, NOW))).toBe("NotInvitee");
      expect(invite.status).toBe("pending");
      expect(invite.pullEvents()).toEqual([]);
    });

    it("refuses an invite that is no longer pending", () => {
      const invite = issue();
      invite.decline(invitee, NOW);
      invite.pullEvents();
      expect(codeOf(invite.accept(invitee, NOW))).toBe("InviteNotPending");
      expect(invite.status).toBe("declined");
      expect(invite.pullEvents()).toEqual([]);
    });

    it("treats a pending invite past its expiry as expired (lazy), up to the last millisecond", () => {
      expect(issue().accept(invitee, at(CIRCLE_INVITE_TTL_MS - 1)).isOk).toBe(
        true,
      );
      const invite = issue();
      expect(codeOf(invite.accept(invitee, EXPIRES))).toBe("InviteExpired");
      expect(invite.status).toBe("pending");
    });
  });

  describe("decline", () => {
    it("lets the invitee decline, recording CircleInviteDeclined", () => {
      const invite = issue();
      expect(invite.decline(invitee, NOW).isOk).toBe(true);
      expect(invite.status).toBe("declined");
      expect(invite.toState().decidedAt).toEqual(NOW);
      expect(invite.pullEvents()).toEqual([
        new CircleInviteDeclined(inviteId, circleId, invitee, NOW),
      ]);
    });

    it("refuses anyone but the invitee, a decided invite and an expired one", () => {
      expect(codeOf(issue().decline(owner, NOW))).toBe("NotInvitee");
      const decided = issue();
      decided.accept(invitee, NOW);
      expect(codeOf(decided.decline(invitee, NOW))).toBe("InviteNotPending");
      expect(codeOf(issue().decline(invitee, EXPIRES))).toBe("InviteExpired");
    });
  });

  describe("revoke", () => {
    it("lets the inviter revoke, recording CircleInviteRevoked", () => {
      const invite = issue(admin);
      expect(invite.revoke(admin, circle(), NOW).isOk).toBe(true);
      expect(invite.status).toBe("revoked");
      expect(invite.toState().revokedBy).toBe(admin);
      expect(invite.toState().decidedAt).toEqual(NOW);
      expect(invite.pullEvents()).toEqual([
        new CircleInviteRevoked(inviteId, circleId, admin, NOW),
      ]);
    });

    it("lets the inviter revoke even after they lost Admin", () => {
      const c = circle();
      c.changePermission(owner, admin, "ViewOnly");
      expect(issue(admin).revoke(admin, c, NOW).isOk).toBe(true);
    });

    it("lets any other current Admin revoke", () => {
      const invite = issue(owner);
      expect(invite.revoke(admin, circle(), NOW).isOk).toBe(true);
      expect(invite.pullEvents()).toEqual([
        new CircleInviteRevoked(inviteId, circleId, admin, NOW),
      ]);
    });

    it("refuses a non-admin member and the invitee", () => {
      const invite = issue();
      expect(codeOf(invite.revoke(member, circle(), NOW))).toBe(
        "CannotRevokeInvite",
      );
      expect(codeOf(invite.revoke(invitee, circle(), NOW))).toBe(
        "CannotRevokeInvite",
      );
      expect(invite.status).toBe("pending");
      expect(invite.pullEvents()).toEqual([]);
    });

    it("refuses an Admin of a DIFFERENT circle", () => {
      const other = Circle.create({
        id: toCircleId("circle-2"),
        ownerId: admin,
        ownerMembershipId: toMembershipId("m-other"),
        name: "Other",
        now: NOW,
      });
      expect(codeOf(issue().revoke(admin, other, NOW))).toBe(
        "CannotRevokeInvite",
      );
    });

    it("only revokes an open invite", () => {
      const decided = issue();
      decided.decline(invitee, NOW);
      expect(codeOf(decided.revoke(owner, circle(), NOW))).toBe(
        "InviteNotPending",
      );
      expect(codeOf(issue().revoke(owner, circle(), EXPIRES))).toBe(
        "InviteExpired",
      );
    });
  });

  describe("withdraw", () => {
    it("revokes a pending invite with no revoker, recording CircleInviteRevoked(null)", () => {
      const invite = issue(admin);
      expect(invite.withdraw(EXPIRES).isOk).toBe(true);
      expect(invite.status).toBe("revoked");
      expect(invite.toState().decidedAt).toEqual(EXPIRES);
      expect(invite.toState().revokedBy).toBeUndefined();
      expect(invite.pullEvents()).toEqual([
        new CircleInviteRevoked(inviteId, circleId, null, EXPIRES),
      ]);
      // A system withdrawal holds no re-invite off.
      expect(invite.holdsOffReinviteAt(EXPIRES)).toBe(false);
    });

    it("refuses an invite that is no longer pending", () => {
      const decided = issue();
      decided.decline(invitee, NOW);
      decided.pullEvents();
      expect(codeOf(decided.withdraw(NOW))).toBe("InviteNotPending");
      expect(decided.status).toBe("declined");
      expect(decided.pullEvents()).toEqual([]);
    });
  });

  describe("expire", () => {
    it("flips a due pending invite to expired, recording CircleInviteExpired", () => {
      const invite = issue();
      expect(invite.expire(EXPIRES).isOk).toBe(true);
      expect(invite.status).toBe("expired");
      expect(invite.toState().decidedAt).toEqual(EXPIRES);
      expect(invite.pullEvents()).toEqual([
        new CircleInviteExpired(inviteId, circleId, EXPIRES),
      ]);
    });

    it("refuses before expiresAt and once decided", () => {
      const early = issue();
      expect(codeOf(early.expire(at(CIRCLE_INVITE_TTL_MS - 1)))).toBe(
        "InviteNotDue",
      );
      expect(early.status).toBe("pending");
      const decided = issue();
      decided.accept(invitee, NOW);
      decided.pullEvents();
      expect(codeOf(decided.expire(EXPIRES))).toBe("InviteNotPending");
      expect(decided.status).toBe("accepted");
      expect(decided.pullEvents()).toEqual([]);
    });
  });

  describe("holdsOffReinviteAt", () => {
    const WEEK = 7 * 24 * 60 * 60 * 1000;

    it("lasts 7 days", () => {
      expect(CIRCLE_REINVITE_COOLDOWN_MS).toBe(WEEK);
    });

    it("holds off for 7 days after a decline or a revoke, to the millisecond", () => {
      const declined = issue();
      declined.decline(invitee, NOW);
      const revoked = issue();
      revoked.revoke(owner, circle(), NOW);
      for (const invite of [declined, revoked]) {
        expect(invite.holdsOffReinviteAt(NOW)).toBe(true);
        expect(invite.holdsOffReinviteAt(at(WEEK - 1))).toBe(true);
        expect(invite.holdsOffReinviteAt(at(WEEK))).toBe(false);
      }
    });

    it("never holds off for a pending, accepted or expired invite", () => {
      expect(issue().holdsOffReinviteAt(NOW)).toBe(false);
      const accepted = issue();
      accepted.accept(invitee, NOW);
      expect(accepted.holdsOffReinviteAt(NOW)).toBe(false);
      const expired = issue();
      expired.expire(EXPIRES);
      expect(expired.holdsOffReinviteAt(EXPIRES)).toBe(false);
    });

    it("needs a decision time (a malformed decided row holds nothing off)", () => {
      const { decidedAt: _drop, ...state } = (() => {
        const i = issue();
        i.decline(invitee, NOW);
        return i.toState();
      })();
      expect(CircleInvite.rehydrate(state).holdsOffReinviteAt(NOW)).toBe(false);
    });
  });

  it("round-trips through rehydrate", () => {
    const invite = issue();
    invite.accept(invitee, NOW);
    expect(CircleInvite.rehydrate(invite.toState()).toState()).toEqual(
      invite.toState(),
    );
  });
});
