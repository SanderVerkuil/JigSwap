import { describe, expect, it } from "vitest";
import {
  toCircleId,
  toCopyId,
  toMemberId,
  toMembershipId,
} from "../../shared-kernel";
import { Circle } from "./circle";
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

      const result = circle.removeMember(owner, alice);
      expect(result.isOk).toBe(true);
      expect(circle.isMember(alice)).toBe(false);
      expect(circle.isMember(owner)).toBe(true); // only the target is dropped
    });

    it("rejects a non-admin actor", () => {
      const circle = newCircle();
      circle.addMember(owner, membershipId(), alice, "ViewOnly", NOW);
      circle.addMember(owner, membershipId(), bob, "ViewOnly", NOW);

      const result = circle.removeMember(alice, bob);
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("NotCircleAdmin");
      expect(circle.isMember(bob)).toBe(true);
    });

    it("refuses to remove the owner", () => {
      const circle = newCircle();
      const result = circle.removeMember(owner, owner);
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("CannotRemoveOwner");
      expect(circle.isMember(owner)).toBe(true);
    });

    it("rejects removing a non-member", () => {
      const circle = newCircle();
      const result = circle.removeMember(owner, alice);
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("NotAMember");
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
