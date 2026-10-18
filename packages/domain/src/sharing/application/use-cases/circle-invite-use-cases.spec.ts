import { beforeEach, describe, expect, it } from "vitest";
import {
  toCircleId,
  toCircleInviteId,
  toMemberId,
} from "../../../shared-kernel";
import {
  CIRCLE_INVITE_TTL_MS,
  CircleId,
  CircleInviteId,
  MAX_CIRCLE_MEMBERS,
} from "../../domain";
import {
  FixedClock,
  InMemoryCircleInviteRepository,
  InMemoryCircleRepository,
  RecordingEventPublisher,
  SequentialCircleIdGenerator,
  SequentialCircleInviteIdGenerator,
  SequentialMembershipIdGenerator,
  StubInvitePolicy,
} from "../testing";
import { makeAcceptCircleInvite } from "./accept-circle-invite";
import { makeAddMember } from "./add-member";
import { makeChangePermission } from "./change-permission";
import { makeCreateCircle } from "./create-circle";
import { makeDeclineCircleInvite } from "./decline-circle-invite";
import { makeExpireCircleInvite } from "./expire-circle-invite";
import { makeInviteToCircle } from "./invite-to-circle";
import { makeRemoveMember } from "./remove-member";
import { makeRevokeCircleInvite } from "./revoke-circle-invite";
import { makeWithdrawInvitesFrom } from "./withdraw-invites-from";

const owner = toMemberId("owner");
const admin = toMemberId("admin");
const member = toMemberId("member");
const invitee = toMemberId("invitee");
const stranger = toMemberId("stranger");
const NOW = new Date("2026-06-08T10:00:00Z");
const later = (ms: number) => new Date(NOW.getTime() + ms);

const codeOf = (result: { isErr: boolean; error?: { code: string } }) =>
  result.isErr ? result.error?.code : undefined;

describe("Sharing circle-invite use cases", () => {
  let circles: InMemoryCircleRepository;
  let invites: InMemoryCircleInviteRepository;
  let policy: StubInvitePolicy;
  let membershipIds: SequentialMembershipIdGenerator;
  let events: RecordingEventPublisher;
  let clock: FixedClock;
  let deps: Parameters<typeof makeAcceptCircleInvite>[0] &
    Parameters<typeof makeInviteToCircle>[0];

  let circleId: CircleId;

  const invite = (
    inviteeId = invitee,
    actorId = owner,
    permission: "ViewOnly" | "Exchange" | "Admin" = "Exchange",
  ) => makeInviteToCircle(deps)({ circleId, actorId, inviteeId, permission });

  const invited = async (inviteeId = invitee, actorId = owner) => {
    const result = await invite(inviteeId, actorId);
    if (!result.isOk) throw new Error(`setup: invite failed ${codeOf(result)}`);
    events.published.length = 0;
    return result.value;
  };

  const accept = (inviteId: CircleInviteId, actorId = invitee) =>
    makeAcceptCircleInvite(deps)({ actorId, inviteId });
  const decline = (inviteId: CircleInviteId, actorId = invitee) =>
    makeDeclineCircleInvite(deps)({ actorId, inviteId });
  const revoke = (inviteId: CircleInviteId, actorId: typeof owner) =>
    makeRevokeCircleInvite(deps)({ actorId, inviteId });
  const expire = (inviteId: CircleInviteId) =>
    makeExpireCircleInvite(deps)({ inviteId });

  beforeEach(async () => {
    circles = new InMemoryCircleRepository();
    invites = new InMemoryCircleInviteRepository();
    policy = new StubInvitePolicy();
    membershipIds = new SequentialMembershipIdGenerator();
    events = new RecordingEventPublisher();
    clock = new FixedClock(NOW);
    deps = {
      circles,
      invites,
      policy,
      inviteIds: new SequentialCircleInviteIdGenerator(),
      membershipIds,
      events,
      clock,
    };

    const created = await makeCreateCircle({
      circles,
      circleIds: new SequentialCircleIdGenerator(),
      membershipIds,
      events,
      clock,
    })({ ownerId: owner, name: "Family" });
    if (!created.isOk) throw new Error("setup: create failed");
    circleId = created.value;
    const add = makeAddMember({ circles, membershipIds, events, clock });
    await add({
      circleId,
      actorId: owner,
      memberId: admin,
      permission: "Admin",
    });
    await add({
      circleId,
      actorId: owner,
      memberId: member,
      permission: "ViewOnly",
    });
    for (const inviter of [owner, admin, member]) {
      policy.allowContact(inviter, invitee);
    }
    events.published.length = 0;
  });

  describe("makeInviteToCircle", () => {
    it("issues a pending invite and publishes CircleInviteIssued", async () => {
      const result = await invite();

      expect(result.isOk).toBe(true);
      if (!result.isOk) return;
      const stored = await invites.findById(result.value);
      expect(stored?.toState()).toMatchObject({
        circleId,
        inviterId: owner,
        inviteeId: invitee,
        permission: "Exchange",
        status: "pending",
        createdAt: NOW,
        expiresAt: later(CIRCLE_INVITE_TTL_MS),
      });
      expect(events.names()).toEqual(["CircleInviteIssued"]);
    });

    it("lets any Admin invite", async () => {
      expect((await invite(invitee, admin)).isOk).toBe(true);
    });

    it("refuses a non-admin member", async () => {
      expect(codeOf(await invite(invitee, member))).toBe("NotCircleAdmin");
      expect(invites.all()).toEqual([]);
    });

    it("answers a non-member or an unknown circle with CircleNotFound", async () => {
      expect(codeOf(await invite(invitee, stranger))).toBe("CircleNotFound");
      const missing = await makeInviteToCircle(deps)({
        circleId: toCircleId("nope"),
        actorId: owner,
        inviteeId: invitee,
        permission: "ViewOnly",
      });
      expect(codeOf(missing)).toBe("CircleNotFound");
    });

    it("refuses an existing member, the actor included", async () => {
      expect(codeOf(await invite(member))).toBe("AlreadyMember");
      expect(codeOf(await invite(owner))).toBe("AlreadyMember");
    });

    it("refuses an uncontactable or blocked member with the same CannotInvite", async () => {
      expect(codeOf(await invite(stranger))).toBe("CannotInvite");
      policy.block(owner, invitee);
      expect(codeOf(await invite(invitee))).toBe("CannotInvite");
      expect(invites.all()).toEqual([]);
      expect(events.published).toEqual([]);
    });

    it("refuses even when an old invite is pending if the contact rule now fails", async () => {
      await invited();
      policy.block(invitee, owner);
      expect(codeOf(await invite())).toBe("CannotInvite");
    });

    it("returns the open invite on a repeat, issuing nothing", async () => {
      const first = await invited();
      const again = await invite(invitee, admin);

      expect(again.isOk && again.value).toBe(first);
      expect(invites.all()).toHaveLength(1);
      expect(events.published).toEqual([]);
    });

    it("expires a stale pending invite and issues a fresh one", async () => {
      const first = await invited();
      clock.set(later(CIRCLE_INVITE_TTL_MS));

      const again = await invite();

      expect(again.isOk).toBe(true);
      if (!again.isOk) return;
      expect(again.value).not.toBe(first);
      expect((await invites.findById(first))?.status).toBe("expired");
      expect((await invites.findById(again.value))?.status).toBe("pending");
      expect(events.names()).toEqual([
        "CircleInviteExpired",
        "CircleInviteIssued",
      ]);
    });

    it("holds off a re-invite for 7 days after a decline or revoke, with CannotInvite", async () => {
      const WEEK = 7 * 24 * 60 * 60 * 1000;
      const declined = await invited();
      await decline(declined);
      expect(codeOf(await invite(invitee, admin))).toBe("CannotInvite");

      const other = toMemberId("other");
      policy.allowContact(owner, other);
      await revoke(await invited(other), owner);
      expect(codeOf(await invite(other))).toBe("CannotInvite");

      clock.set(later(WEEK));
      expect((await invite()).isOk).toBe(true);
      expect((await invite(other)).isOk).toBe(true);
    });

    it("does not hold off after an expiry", async () => {
      const first = await invited();
      clock.set(later(CIRCLE_INVITE_TTL_MS));
      await expire(first);
      expect((await invite()).isOk).toBe(true);
    });

    it("counts open invites against the member cap", async () => {
      // 3 members; fill the remaining seats with open invites.
      const free = MAX_CIRCLE_MEMBERS - 3;
      for (let i = 1; i < free; i += 1) {
        const other = toMemberId(`other-${i}`);
        policy.allowContact(owner, other);
        await invited(other);
      }
      // The last free seat can still be offered.
      expect((await invite()).isOk).toBe(true);

      const extra = toMemberId("extra");
      policy.allowContact(owner, extra);
      expect(codeOf(await invite(extra))).toBe("CircleFull");
    });

    it("does not count expired or decided invites against the cap", async () => {
      const free = MAX_CIRCLE_MEMBERS - 3;
      const ids: CircleInviteId[] = [];
      for (let i = 1; i <= free; i += 1) {
        const other = toMemberId(`other-${i}`);
        policy.allowContact(owner, other);
        ids.push(await invited(other));
      }
      await decline(ids[0], toMemberId("other-1"));
      expect((await invite()).isOk).toBe(true);

      clock.set(later(CIRCLE_INVITE_TTL_MS));
      const extra = toMemberId("extra");
      policy.allowContact(owner, extra);
      expect((await invite(extra)).isOk).toBe(true);
    });
  });

  describe("makeAcceptCircleInvite", () => {
    it("seats the invitee at the invite's permission and publishes both events", async () => {
      const inviteId = await invited();

      const result = await accept(inviteId);

      expect(result.isOk && result.value).toBe(circleId);
      const circle = await circles.findById(circleId);
      expect(
        circle?.members.find((m) => m.memberId === invitee)?.permission,
      ).toBe("Exchange");
      expect((await invites.findById(inviteId))?.status).toBe("accepted");
      expect(events.names()).toEqual([
        "CircleInviteAccepted",
        "MemberJoinedCircle",
      ]);
    });

    it("answers an unknown invite and someone else's invite with InviteNotFound", async () => {
      const inviteId = await invited();
      expect(codeOf(await accept(toCircleInviteId("nope")))).toBe(
        "InviteNotFound",
      );
      expect(codeOf(await accept(inviteId, owner))).toBe("InviteNotFound");
      expect((await invites.findById(inviteId))?.status).toBe("pending");
    });

    it("refuses after expiry, and an already-decided invite", async () => {
      const inviteId = await invited();
      clock.set(later(CIRCLE_INVITE_TTL_MS));
      expect(codeOf(await accept(inviteId))).toBe("InviteExpired");

      clock.set(NOW);
      await decline(inviteId);
      expect(codeOf(await accept(inviteId))).toBe("InviteNotPending");
    });

    it("refuses generically when the pair is now blocked, persisting nothing", async () => {
      const inviteId = await invited();
      policy.block(invitee, owner);

      expect(codeOf(await accept(inviteId))).toBe("InviteNotFound");
      expect((await circles.findById(circleId))?.isMember(invitee)).toBe(false);
      expect((await invites.findById(inviteId))?.status).toBe("pending");
      expect(events.published).toEqual([]);
    });

    it("refuses generically when the inviter is no longer an Admin", async () => {
      const inviteId = await invited(invitee, admin);
      await makeChangePermission({ circles, events })({
        circleId,
        actorId: owner,
        memberId: admin,
        permission: "ViewOnly",
      });

      expect(codeOf(await accept(inviteId))).toBe("InviteNotFound");
      expect((await circles.findById(circleId))?.isMember(invitee)).toBe(false);
    });

    it("refuses generically when the inviter left the circle", async () => {
      const inviteId = await invited(invitee, admin);
      await makeRemoveMember({ circles, events, clock })({
        circleId,
        actorId: owner,
        memberId: admin,
      });

      expect(codeOf(await accept(inviteId))).toBe("InviteNotFound");
    });

    it("refuses generically when the circle is gone", async () => {
      const inviteId = await invited();
      const orphan = new InMemoryCircleRepository();
      const result = await makeAcceptCircleInvite({ ...deps, circles: orphan })(
        { actorId: invitee, inviteId },
      );
      expect(codeOf(result)).toBe("InviteNotFound");
    });

    it("refuses with CircleFull when the circle filled up meanwhile", async () => {
      const inviteId = await invited();
      const add = makeAddMember({ circles, membershipIds, events, clock });
      for (let i = 1; i <= MAX_CIRCLE_MEMBERS - 3; i += 1) {
        await add({
          circleId,
          actorId: owner,
          memberId: toMemberId(`seat-${i}`),
          permission: "ViewOnly",
        });
      }

      expect(codeOf(await accept(inviteId))).toBe("CircleFull");
      expect((await invites.findById(inviteId))?.status).toBe("pending");
    });
  });

  describe("makeDeclineCircleInvite", () => {
    it("declines and publishes CircleInviteDeclined", async () => {
      const inviteId = await invited();

      expect((await decline(inviteId)).isOk).toBe(true);
      expect((await invites.findById(inviteId))?.status).toBe("declined");
      expect(events.names()).toEqual(["CircleInviteDeclined"]);
    });

    it("answers an unknown or foreign invite with InviteNotFound", async () => {
      const inviteId = await invited();
      expect(codeOf(await decline(toCircleInviteId("nope")))).toBe(
        "InviteNotFound",
      );
      expect(codeOf(await decline(inviteId, owner))).toBe("InviteNotFound");
    });

    it("refuses an already-decided invite", async () => {
      const inviteId = await invited();
      await decline(inviteId);
      events.published.length = 0;
      expect(codeOf(await decline(inviteId))).toBe("InviteNotPending");
      expect(events.published).toEqual([]);
    });
  });

  describe("makeRevokeCircleInvite", () => {
    it("lets the inviter revoke and publishes CircleInviteRevoked", async () => {
      const inviteId = await invited(invitee, admin);

      expect((await revoke(inviteId, admin)).isOk).toBe(true);
      expect((await invites.findById(inviteId))?.status).toBe("revoked");
      expect(events.names()).toEqual(["CircleInviteRevoked"]);
    });

    it("lets another Admin revoke", async () => {
      const inviteId = await invited(invitee, owner);
      expect((await revoke(inviteId, admin)).isOk).toBe(true);
    });

    it("answers a non-admin, the invitee and an unknown id with InviteNotFound", async () => {
      const inviteId = await invited();
      expect(codeOf(await revoke(inviteId, member))).toBe("InviteNotFound");
      expect(codeOf(await revoke(inviteId, invitee))).toBe("InviteNotFound");
      expect(codeOf(await revoke(toCircleInviteId("nope"), owner))).toBe(
        "InviteNotFound",
      );
      expect((await invites.findById(inviteId))?.status).toBe("pending");
    });

    it("answers an invite whose circle is gone with InviteNotFound", async () => {
      const inviteId = await invited();
      const result = await makeRevokeCircleInvite({
        ...deps,
        circles: new InMemoryCircleRepository(),
      })({ actorId: owner, inviteId });
      expect(codeOf(result)).toBe("InviteNotFound");
    });

    it("only revokes while pending", async () => {
      const inviteId = await invited();
      await decline(inviteId);
      events.published.length = 0;
      expect(codeOf(await revoke(inviteId, owner))).toBe("InviteNotPending");
      expect(events.published).toEqual([]);
    });
  });

  describe("makeWithdrawInvitesFrom", () => {
    const withdraw = (inviterId: typeof owner) =>
      makeWithdrawInvitesFrom(deps)({ circleId, inviterId });

    it("withdraws only that inviter's pending invites, publishing one revoke each", async () => {
      const other = toMemberId("other");
      policy.allowContact(admin, other);
      const fromAdmin = await invited(invitee, admin);
      const fromAdminToo = await invited(other, admin);
      const third = toMemberId("third");
      policy.allowContact(owner, third);
      const fromOwner = await invited(third, owner);

      expect(await withdraw(admin)).toBe(2);

      for (const id of [fromAdmin, fromAdminToo]) {
        expect((await invites.findById(id))?.status).toBe("revoked");
      }
      expect((await invites.findById(fromOwner))?.status).toBe("pending");
      expect(events.names()).toEqual([
        "CircleInviteRevoked",
        "CircleInviteRevoked",
      ]);
      // The withdrawn invitee can be invited again straight away.
      expect((await invite(invitee, owner)).isOk).toBe(true);
    });

    it("leaves decided invites alone and publishes nothing when none are pending", async () => {
      const declined = await invited(invitee, admin);
      await decline(declined);
      events.published.length = 0;

      expect(await withdraw(admin)).toBe(0);
      expect((await invites.findById(declined))?.status).toBe("declined");
      expect(events.published).toEqual([]);
    });
  });

  describe("makeExpireCircleInvite", () => {
    it("flips a due pending invite to expired and publishes CircleInviteExpired", async () => {
      const inviteId = await invited();
      clock.set(later(CIRCLE_INVITE_TTL_MS));

      expect(await expire(inviteId)).toBe(true);
      expect((await invites.findById(inviteId))?.status).toBe("expired");
      expect(events.names()).toEqual(["CircleInviteExpired"]);
    });

    it("is a no-op for an unknown, decided or not-yet-due invite", async () => {
      expect(await expire(toCircleInviteId("nope"))).toBe(false);

      const early = await invited();
      expect(await expire(early)).toBe(false);
      expect((await invites.findById(early))?.status).toBe("pending");

      await accept(early);
      clock.set(later(CIRCLE_INVITE_TTL_MS));
      events.published.length = 0;
      expect(await expire(early)).toBe(false);
      expect((await invites.findById(early))?.status).toBe("accepted");
      expect(events.published).toEqual([]);
    });
  });
});
