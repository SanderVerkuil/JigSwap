import { describe, expect, it } from "vitest";
import {
  toCircleId,
  toCopyId,
  toMemberId,
  toMembershipId,
} from "../../shared-kernel";
import { Circle, MAX_CIRCLE_MEMBERS } from "./circle";
import { MemberLeftCircle } from "./events";
import { MembershipId } from "./ids";

const owner = toMemberId("owner");
const alice = toMemberId("alice");
const bob = toMemberId("bob");
const stranger = toMemberId("stranger");
const circleId = toCircleId("circle-1");
const NOW = new Date("2026-06-08T10:00:00Z");

let seq = 0;
const membershipId = (): MembershipId => {
  seq += 1;
  return toMembershipId(`membership-${seq}`);
};

const newCircle = (): Circle =>
  Circle.create({
    id: circleId,
    ownerId: owner,
    ownerMembershipId: membershipId(),
    name: "Family",
    now: NOW,
  });

describe("Circle", () => {
  it("opens with the owner as its only member, implicitly Admin", () => {
    const ownerMembershipId = membershipId();
    const circle = Circle.create({
      id: circleId,
      ownerId: owner,
      ownerMembershipId,
      name: "Family",
      now: NOW,
    });
    expect(circle.name).toBe("Family");
    expect(circle.ownerId).toBe(owner);
    expect(circle.isMember(owner)).toBe(true);
    expect(circle.members).toHaveLength(1);
    expect(circle.members[0].permission).toBe("Admin");
    expect(circle.members[0].id).toBe(ownerMembershipId);
    expect(circle.members[0].joinedAt).toBe(NOW);
  });

  it("records CircleCreated on open", () => {
    const events = newCircle().pullEvents();
    expect(events.map((e) => e.name)).toEqual(["CircleCreated"]);
  });

  describe("addMember", () => {
    it("lets an admin add a member and records MemberJoinedCircle", () => {
      const circle = newCircle();
      circle.pullEvents();

      const result = circle.addMember(
        owner,
        membershipId(),
        alice,
        "ViewOnly",
        NOW,
      );

      expect(result.isOk).toBe(true);
      expect(circle.isMember(alice)).toBe(true);
      expect(circle.pullEvents().map((e) => e.name)).toEqual([
        "MemberJoinedCircle",
      ]);
    });

    it("rejects a non-admin actor", () => {
      const circle = newCircle();
      circle.addMember(owner, membershipId(), alice, "ViewOnly", NOW); // alice is ViewOnly
      circle.pullEvents();

      const result = circle.addMember(
        alice,
        membershipId(),
        bob,
        "ViewOnly",
        NOW,
      );

      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("NotCircleAdmin");
      expect(circle.isMember(bob)).toBe(false);
      expect(circle.pullEvents()).toHaveLength(0);
    });

    it("rejects an actor who is not a member at all", () => {
      const circle = newCircle();
      const result = circle.addMember(
        stranger,
        membershipId(),
        alice,
        "Admin",
        NOW,
      );
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("NotCircleAdmin");
    });

    it("rejects a duplicate member", () => {
      const circle = newCircle();
      circle.addMember(owner, membershipId(), alice, "ViewOnly", NOW);
      circle.pullEvents();

      const result = circle.addMember(
        owner,
        membershipId(),
        alice,
        "Admin",
        NOW,
      );

      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("AlreadyMember");
      expect(circle.members).toHaveLength(2);
    });

    it("seats members up to MAX_CIRCLE_MEMBERS (owner included), then refuses with CircleFull", () => {
      const circle = newCircle();
      for (let i = 1; i < MAX_CIRCLE_MEMBERS - 1; i += 1) {
        circle.addMember(
          owner,
          membershipId(),
          toMemberId(`m-${i}`),
          "ViewOnly",
          NOW,
        );
      }
      expect(circle.members).toHaveLength(MAX_CIRCLE_MEMBERS - 1);

      // The 50th seat is still free.
      const last = circle.addMember(
        owner,
        membershipId(),
        alice,
        "ViewOnly",
        NOW,
      );
      expect(last.isOk).toBe(true);
      expect(circle.members).toHaveLength(50);
      circle.pullEvents();

      // The 51st is refused, nothing is seated and nothing is recorded.
      const result = circle.addMember(
        owner,
        membershipId(),
        bob,
        "ViewOnly",
        NOW,
      );
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("CircleFull");
      expect(circle.isMember(bob)).toBe(false);
      expect(circle.members).toHaveLength(50);
      expect(circle.pullEvents()).toHaveLength(0);
    });

    it("lets a promoted admin add further members", () => {
      const circle = newCircle();
      circle.addMember(owner, membershipId(), alice, "Admin", NOW);

      const result = circle.addMember(
        alice,
        membershipId(),
        bob,
        "ViewOnly",
        NOW,
      );
      expect(result.isOk).toBe(true);
      expect(circle.isMember(bob)).toBe(true);
    });
  });

  describe("removeMember", () => {
    it("lets an admin remove a member", () => {
      const circle = newCircle();
      circle.addMember(owner, membershipId(), alice, "ViewOnly", NOW);

      circle.pullEvents();
      const result = circle.removeMember(owner, alice, NOW);
      expect(result.isOk).toBe(true);
      expect(circle.isMember(alice)).toBe(false);
      expect(circle.isMember(owner)).toBe(true); // only the target is dropped
    });

    it("records MemberLeftCircle with reason removed", () => {
      const circle = newCircle();
      circle.addMember(owner, membershipId(), alice, "ViewOnly", NOW);
      circle.pullEvents();

      circle.removeMember(owner, alice, NOW);

      const events = circle.pullEvents();
      expect(events).toHaveLength(1);
      const event = events[0] as MemberLeftCircle;
      expect(event).toBeInstanceOf(MemberLeftCircle);
      expect(event.name).toBe("MemberLeftCircle");
      expect(event.circleId).toBe(circleId);
      expect(event.memberId).toBe(alice);
      expect(event.reason).toBe("removed");
      expect(event.occurredAt).toBe(NOW);
    });

    it("rejects a non-admin actor", () => {
      const circle = newCircle();
      circle.addMember(owner, membershipId(), alice, "ViewOnly", NOW);
      circle.addMember(owner, membershipId(), bob, "ViewOnly", NOW);

      circle.pullEvents();

      const result = circle.removeMember(alice, bob, NOW);
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("NotCircleAdmin");
      expect(circle.isMember(bob)).toBe(true);
      expect(circle.pullEvents()).toHaveLength(0);
    });

    it("refuses to remove the owner", () => {
      const circle = newCircle();
      circle.pullEvents();
      const result = circle.removeMember(owner, owner, NOW);
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("CannotRemoveOwner");
      expect(circle.isMember(owner)).toBe(true);
      expect(circle.pullEvents()).toHaveLength(0);
    });

    it("rejects removing a non-member", () => {
      const circle = newCircle();
      circle.pullEvents();
      const result = circle.removeMember(owner, alice, NOW);
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("NotAMember");
      expect(circle.pullEvents()).toHaveLength(0);
    });
  });

  describe("leave", () => {
    it("lets a member leave and records MemberLeftCircle with reason left", () => {
      const circle = newCircle();
      circle.addMember(owner, membershipId(), alice, "ViewOnly", NOW);
      circle.addMember(owner, membershipId(), bob, "ViewOnly", NOW);
      circle.pullEvents();

      const result = circle.leave(alice, NOW);

      expect(result.isOk).toBe(true);
      expect(circle.isMember(alice)).toBe(false);
      // Only the leaver goes.
      expect(circle.isMember(bob)).toBe(true);
      expect(circle.isMember(owner)).toBe(true);
      const events = circle.pullEvents();
      expect(events).toHaveLength(1);
      const event = events[0] as MemberLeftCircle;
      expect(event).toBeInstanceOf(MemberLeftCircle);
      expect(event.circleId).toBe(circleId);
      expect(event.memberId).toBe(alice);
      expect(event.reason).toBe("left");
      expect(event.occurredAt).toBe(NOW);
    });

    it("lets an admin who is not the owner leave", () => {
      const circle = newCircle();
      circle.addMember(owner, membershipId(), alice, "Admin", NOW);

      expect(circle.leave(alice, NOW).isOk).toBe(true);
      expect(circle.isMember(alice)).toBe(false);
    });

    it("refuses to let the owner leave", () => {
      const circle = newCircle();
      circle.pullEvents();

      const result = circle.leave(owner, NOW);

      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("OwnerCannotLeave");
      expect(circle.isMember(owner)).toBe(true);
      expect(circle.pullEvents()).toHaveLength(0);
    });

    it("rejects a non-member", () => {
      const circle = newCircle();
      circle.pullEvents();

      const result = circle.leave(stranger, NOW);

      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("NotAMember");
      expect(circle.members).toHaveLength(1);
      expect(circle.pullEvents()).toHaveLength(0);
    });
  });

  describe("changePermission", () => {
    it("lets an admin change a member's permission", () => {
      const circle = newCircle();
      circle.addMember(owner, membershipId(), alice, "ViewOnly", NOW);

      const result = circle.changePermission(owner, alice, "Exchange");
      expect(result.isOk).toBe(true);
      expect(circle.members.find((m) => m.memberId === alice)?.permission).toBe(
        "Exchange",
      );
      // Only the named member changes; the owner's seat is untouched.
      expect(circle.members.find((m) => m.memberId === owner)?.permission).toBe(
        "Admin",
      );
    });

    it("rejects a non-admin actor", () => {
      const circle = newCircle();
      circle.addMember(owner, membershipId(), alice, "ViewOnly", NOW);
      circle.addMember(owner, membershipId(), bob, "ViewOnly", NOW);

      const result = circle.changePermission(alice, bob, "Admin");
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("NotCircleAdmin");
    });

    it("refuses to change the owner's permission", () => {
      const circle = newCircle();
      const result = circle.changePermission(owner, owner, "ViewOnly");
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("CannotRemoveOwner");
      expect(circle.members[0].permission).toBe("Admin");
    });

    it("rejects changing a non-member", () => {
      const circle = newCircle();
      const result = circle.changePermission(owner, alice, "Admin");
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("NotAMember");
    });

    it("rejects a no-op change to the same permission", () => {
      const circle = newCircle();
      circle.addMember(owner, membershipId(), alice, "ViewOnly", NOW);

      const result = circle.changePermission(owner, alice, "ViewOnly");
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("DuplicatePermission");
    });
  });

  describe("shareCopy", () => {
    const copyId = toCopyId("copy-1");

    it("lets an admin share a copy and records CopySharedToCircle", () => {
      const circle = newCircle();
      circle.pullEvents();

      const result = circle.shareCopy(owner, copyId, NOW);
      expect(result.isOk).toBe(true);
      const events = circle.pullEvents();
      expect(events.map((e) => e.name)).toEqual(["CopySharedToCircle"]);
    });

    it("rejects a non-admin actor", () => {
      const circle = newCircle();
      circle.addMember(owner, membershipId(), alice, "Exchange", NOW);
      circle.pullEvents();

      const result = circle.shareCopy(alice, copyId, NOW);
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("NotCircleAdmin");
      expect(circle.pullEvents()).toHaveLength(0);
    });
  });

  it("round-trips through toState/rehydrate preserving memberships", () => {
    const circle = newCircle();
    circle.addMember(owner, membershipId(), alice, "Exchange", NOW);

    const rehydrated = Circle.rehydrate(circle.toState());
    expect(rehydrated.members).toHaveLength(2);
    expect(rehydrated.isMember(alice)).toBe(true);
    expect(
      rehydrated.members.find((m) => m.memberId === alice)?.permission,
    ).toBe("Exchange");
  });
});
