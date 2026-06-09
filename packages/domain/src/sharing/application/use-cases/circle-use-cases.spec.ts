import { beforeEach, describe, expect, it } from "vitest";
import { toId } from "../../../shared-kernel";
import { CircleId, CopyId, MemberId } from "../../domain";
import {
  FixedClock,
  InMemoryCircleRepository,
  RecordingEventPublisher,
  SequentialCircleIdGenerator,
  SequentialMembershipIdGenerator,
} from "../testing";
import { makeAddMember } from "./add-member";
import { makeChangePermission } from "./change-permission";
import { makeCreateCircle } from "./create-circle";
import { makeRemoveMember } from "./remove-member";
import { makeShareCopyToCircle } from "./share-copy-to-circle";

const owner = toId<"MemberId">("owner") as MemberId;
const alice = toId<"MemberId">("alice") as MemberId;
const bob = toId<"MemberId">("bob") as MemberId;
const missingCircle = toId<"CircleId">("nope") as CircleId;
const copyId = toId<"CopyId">("copy-1") as CopyId;
const NOW = new Date("2026-06-08T10:00:00Z");

describe("Sharing circle use cases", () => {
  let circles: InMemoryCircleRepository;
  let membershipIds: SequentialMembershipIdGenerator;
  let events: RecordingEventPublisher;
  let clock: FixedClock;

  let createCircle: ReturnType<typeof makeCreateCircle>;
  let addMember: ReturnType<typeof makeAddMember>;
  let removeMember: ReturnType<typeof makeRemoveMember>;
  let changePermission: ReturnType<typeof makeChangePermission>;
  let shareCopy: ReturnType<typeof makeShareCopyToCircle>;

  beforeEach(() => {
    circles = new InMemoryCircleRepository();
    membershipIds = new SequentialMembershipIdGenerator();
    events = new RecordingEventPublisher();
    clock = new FixedClock(NOW);

    createCircle = makeCreateCircle({
      circles,
      circleIds: new SequentialCircleIdGenerator(),
      membershipIds,
      events,
      clock,
    });
    addMember = makeAddMember({ circles, membershipIds, events, clock });
    removeMember = makeRemoveMember({ circles, events });
    changePermission = makeChangePermission({ circles, events });
    shareCopy = makeShareCopyToCircle({ circles, events, clock });
  });

  // Helper: create a circle and return its id (creation never fails).
  const openCircle = async (): Promise<CircleId> => {
    const result = await createCircle({ ownerId: owner, name: "Family" });
    if (!result.isOk) throw new Error("setup: create failed");
    return result.value;
  };

  describe("makeCreateCircle", () => {
    it("creates a circle owned by the actor and publishes CircleCreated", async () => {
      const result = await createCircle({ ownerId: owner, name: "Family" });

      expect(result.isOk).toBe(true);
      expect(circles.size()).toBe(1);
      if (result.isOk) {
        const circle = await circles.findById(result.value);
        expect(circle?.ownerId).toBe(owner);
        expect(circle?.isMember(owner)).toBe(true);
      }
      expect(events.names()).toEqual(["CircleCreated"]);
    });
  });

  describe("makeAddMember", () => {
    it("adds a member by an admin and publishes MemberJoinedCircle", async () => {
      const circleId = await openCircle();
      events.published.length = 0;

      const result = await addMember({
        circleId,
        actorId: owner,
        memberId: alice,
        permission: "ViewOnly",
      });

      expect(result.isOk).toBe(true);
      expect((await circles.findById(circleId))?.isMember(alice)).toBe(true);
      expect(events.names()).toEqual(["MemberJoinedCircle"]);
    });

    it("returns CircleNotFound for an unknown circle", async () => {
      const result = await addMember({
        circleId: missingCircle,
        actorId: owner,
        memberId: alice,
        permission: "ViewOnly",
      });

      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("CircleNotFound");
    });

    it("rejects a non-admin actor and writes nothing", async () => {
      const circleId = await openCircle();
      await addMember({ circleId, actorId: owner, memberId: alice, permission: "ViewOnly" });
      events.published.length = 0;

      const result = await addMember({
        circleId,
        actorId: alice, // only ViewOnly
        memberId: bob,
        permission: "ViewOnly",
      });

      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("NotCircleAdmin");
      expect((await circles.findById(circleId))?.isMember(bob)).toBe(false);
      expect(events.published).toHaveLength(0);
    });

    it("rejects adding an existing member", async () => {
      const circleId = await openCircle();
      await addMember({ circleId, actorId: owner, memberId: alice, permission: "ViewOnly" });

      const result = await addMember({
        circleId,
        actorId: owner,
        memberId: alice,
        permission: "Admin",
      });

      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("AlreadyMember");
    });
  });

  describe("makeRemoveMember", () => {
    it("removes a member by an admin", async () => {
      const circleId = await openCircle();
      await addMember({ circleId, actorId: owner, memberId: alice, permission: "ViewOnly" });

      const result = await removeMember({ circleId, actorId: owner, memberId: alice });

      expect(result.isOk).toBe(true);
      expect((await circles.findById(circleId))?.isMember(alice)).toBe(false);
    });

    it("refuses to remove the owner", async () => {
      const circleId = await openCircle();

      const result = await removeMember({ circleId, actorId: owner, memberId: owner });

      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("CannotRemoveOwner");
    });

    it("returns CircleNotFound for an unknown circle", async () => {
      const result = await removeMember({
        circleId: missingCircle,
        actorId: owner,
        memberId: alice,
      });
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("CircleNotFound");
    });
  });

  describe("makeChangePermission", () => {
    it("changes a member's permission by an admin", async () => {
      const circleId = await openCircle();
      await addMember({ circleId, actorId: owner, memberId: alice, permission: "ViewOnly" });

      const result = await changePermission({
        circleId,
        actorId: owner,
        memberId: alice,
        permission: "Exchange",
      });

      expect(result.isOk).toBe(true);
      const circle = await circles.findById(circleId);
      expect(circle?.members.find((m) => m.memberId === alice)?.permission).toBe(
        "Exchange",
      );
    });

    it("rejects a no-op permission change", async () => {
      const circleId = await openCircle();
      await addMember({ circleId, actorId: owner, memberId: alice, permission: "ViewOnly" });

      const result = await changePermission({
        circleId,
        actorId: owner,
        memberId: alice,
        permission: "ViewOnly",
      });

      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("DuplicatePermission");
    });

    it("returns CircleNotFound for an unknown circle", async () => {
      const result = await changePermission({
        circleId: missingCircle,
        actorId: owner,
        memberId: alice,
        permission: "Admin",
      });
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("CircleNotFound");
    });
  });

  describe("makeShareCopyToCircle", () => {
    it("shares a copy by an admin and publishes CopySharedToCircle", async () => {
      const circleId = await openCircle();
      events.published.length = 0;

      const result = await shareCopy({ circleId, actorId: owner, copyId });

      expect(result.isOk).toBe(true);
      expect(events.names()).toEqual(["CopySharedToCircle"]);
    });

    it("rejects a non-admin actor", async () => {
      const circleId = await openCircle();
      await addMember({ circleId, actorId: owner, memberId: alice, permission: "Exchange" });
      events.published.length = 0;

      const result = await shareCopy({ circleId, actorId: alice, copyId });

      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("NotCircleAdmin");
      expect(events.published).toHaveLength(0);
    });

    it("returns CircleNotFound for an unknown circle", async () => {
      const result = await shareCopy({ circleId: missingCircle, actorId: owner, copyId });
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("CircleNotFound");
    });
  });

  describe("listForMember", () => {
    it("returns every circle a member belongs to (the VisibilityPolicy wiring seam)", async () => {
      const first = await openCircle();
      const second = await openCircle();
      await addMember({ circleId: first, actorId: owner, memberId: alice, permission: "ViewOnly" });

      const ownerCircles = await circles.listForMember(owner);
      const aliceCircles = await circles.listForMember(alice);

      expect(ownerCircles.map((c) => c.id).sort()).toEqual([first, second].sort());
      expect(aliceCircles.map((c) => c.id)).toEqual([first]);
    });
  });
});
