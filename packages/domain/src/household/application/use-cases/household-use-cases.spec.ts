import { beforeEach, describe, expect, it } from "vitest";
import {
  makeAcceptHouseholdInvite,
  makeCreateHousehold,
  makeDeclineHouseholdInvite,
  makeInviteToHousehold,
  makeLeaveHousehold,
  makeRemoveHouseholdMember,
} from ".";
import { toMemberId } from "../../../shared-kernel";
import { HouseholdId, HouseholdInviteId } from "../../domain";
import {
  FixedClock,
  InMemoryHouseholdInviteRepository,
  InMemoryHouseholdRepository,
  RecordingEventPublisher,
  SequentialHouseholdIdGenerator,
  SequentialHouseholdInviteIdGenerator,
} from "../testing";

const ann = toMemberId("ann");
const bob = toMemberId("bob");
const cat = toMemberId("cat");

let households: InMemoryHouseholdRepository;
let invites: InMemoryHouseholdInviteRepository;
let events: RecordingEventPublisher;
let clock: FixedClock;
let deps: {
  households: InMemoryHouseholdRepository;
  invites: InMemoryHouseholdInviteRepository;
  householdIds: SequentialHouseholdIdGenerator;
  inviteIds: SequentialHouseholdInviteIdGenerator;
  events: RecordingEventPublisher;
  clock: FixedClock;
};

beforeEach(() => {
  households = new InMemoryHouseholdRepository();
  invites = new InMemoryHouseholdInviteRepository();
  events = new RecordingEventPublisher();
  clock = new FixedClock(new Date("2026-10-01T00:00:00Z"));
  deps = {
    households,
    invites,
    householdIds: new SequentialHouseholdIdGenerator(),
    inviteIds: new SequentialHouseholdInviteIdGenerator(),
    events,
    clock,
  };
});

const create = async (actorId = ann): Promise<HouseholdId> => {
  const result = await makeCreateHousehold(deps)({ actorId });
  if (result.isErr) throw result.error;
  return result.value;
};

const invite = async (
  actorId = ann,
  inviteeId = bob,
): Promise<HouseholdInviteId> => {
  const result = await makeInviteToHousehold(deps)({ actorId, inviteeId });
  if (result.isErr) throw result.error;
  return result.value;
};

const accept = (actorId: typeof ann, inviteId: HouseholdInviteId) =>
  makeAcceptHouseholdInvite(deps)({ actorId, inviteId });

describe("createHousehold", () => {
  it("founds a household with the actor as admin", async () => {
    const id = await create();
    const household = await households.findById(id);
    expect(household?.isAdmin(ann)).toBe(true);
    expect(events.names()).toEqual(["HouseholdFounded"]);
  });

  it("rejects a member who is already in a household", async () => {
    await create();
    const result = await makeCreateHousehold(deps)({ actorId: ann });
    expect(result.isErr && result.error.code).toBe("AlreadyInHousehold");
  });
});

describe("inviteToHousehold", () => {
  it("sends a pending invite from the admin", async () => {
    await create();
    const id = await invite();
    expect((await invites.findById(id))?.status).toBe("pending");
    expect(events.names()).toContain("HouseholdInviteSent");
  });

  it("rejects an actor without a household", async () => {
    const result = await makeInviteToHousehold(deps)({
      actorId: ann,
      inviteeId: bob,
    });
    expect(result.isErr && result.error.code).toBe("NotInHousehold");
  });

  it("rejects a non-admin inviter", async () => {
    await create();
    await accept(bob, await invite());
    const result = await makeInviteToHousehold(deps)({
      actorId: bob,
      inviteeId: cat,
    });
    expect(result.isErr && result.error.code).toBe("NotHouseholdAdmin");
  });

  it("rejects inviting someone who is already in a household", async () => {
    await create();
    await create(bob);
    const result = await makeInviteToHousehold(deps)({
      actorId: ann,
      inviteeId: bob,
    });
    expect(result.isErr && result.error.code).toBe("InviteeAlreadyInHousehold");
  });

  it("rejects a duplicate pending invite", async () => {
    await create();
    await invite();
    const result = await makeInviteToHousehold(deps)({
      actorId: ann,
      inviteeId: bob,
    });
    expect(result.isErr && result.error.code).toBe("DuplicateInvite");
  });

  it("rejects inviting yourself", async () => {
    await create();
    const result = await makeInviteToHousehold(deps)({
      actorId: ann,
      inviteeId: ann,
    });
    // You are already in (your own) household, which is checked first.
    expect(result.isErr && result.error.code).toBe("InviteeAlreadyInHousehold");
  });
});

describe("acceptHouseholdInvite", () => {
  it("admits the invitee and records the acceptance", async () => {
    const householdId = await create();
    const inviteId = await invite();
    const result = await accept(bob, inviteId);
    expect(result.isOk).toBe(true);
    expect((await households.findById(householdId))?.isMember(bob)).toBe(true);
    expect((await invites.findById(inviteId))?.status).toBe("accepted");
    expect(events.names()).toEqual(
      expect.arrayContaining([
        "HouseholdInviteAccepted",
        "HouseholdMemberJoined",
      ]),
    );
  });

  it("rejects anyone but the invitee", async () => {
    await create();
    const result = await accept(cat, await invite());
    expect(result.isErr && result.error.code).toBe("NotInvitee");
  });

  it("rejects an unknown invite", async () => {
    const result = await accept(bob, "nope" as HouseholdInviteId);
    expect(result.isErr && result.error.code).toBe("InviteNotFound");
  });

  it("rejects when the invitee joined another household meanwhile", async () => {
    await create();
    const inviteId = await invite();
    await create(bob);
    const result = await accept(bob, inviteId);
    expect(result.isErr && result.error.code).toBe("AlreadyInHousehold");
    expect((await invites.findById(inviteId))?.status).toBe("pending");
  });

  it("rejects when the household has dissolved", async () => {
    await create();
    const inviteId = await invite();
    // Re-save the invite after the dissolve cascade would have removed it, to model a stale read.
    const stale = await invites.findById(inviteId);
    await makeLeaveHousehold(deps)({ actorId: ann });
    if (stale) await invites.save(stale);
    const result = await accept(bob, inviteId);
    expect(result.isErr && result.error.code).toBe("HouseholdNotFound");
  });
});

describe("declineHouseholdInvite", () => {
  it("declines without admitting", async () => {
    const householdId = await create();
    const inviteId = await invite();
    const result = await makeDeclineHouseholdInvite(deps)({
      actorId: bob,
      inviteId,
    });
    expect(result.isOk).toBe(true);
    expect((await invites.findById(inviteId))?.status).toBe("declined");
    expect((await households.findById(householdId))?.isMember(bob)).toBe(false);
  });

  it("rejects anyone but the invitee", async () => {
    await create();
    const result = await makeDeclineHouseholdInvite(deps)({
      actorId: ann,
      inviteId: await invite(),
    });
    expect(result.isErr && result.error.code).toBe("NotInvitee");
  });
});

describe("leaveHousehold", () => {
  it("removes the member and keeps the household", async () => {
    const householdId = await create();
    await accept(bob, await invite());
    const result = await makeLeaveHousehold(deps)({ actorId: bob });
    expect(result.isOk && result.value).toEqual({ dissolved: false });
    expect((await households.findById(householdId))?.isMember(bob)).toBe(false);
    expect(await households.findByMember(bob)).toBeNull();
  });

  it("dissolves on last leave and drops pending invites", async () => {
    const householdId = await create();
    const inviteId = await invite();
    const result = await makeLeaveHousehold(deps)({ actorId: ann });
    expect(result.isOk && result.value).toEqual({ dissolved: true });
    expect(await households.findById(householdId)).toBeNull();
    expect(await invites.findById(inviteId)).toBeNull();
    expect(events.names()).toContain("HouseholdDissolved");
  });

  it("rejects a member without a household", async () => {
    const result = await makeLeaveHousehold(deps)({ actorId: ann });
    expect(result.isErr && result.error.code).toBe("NotInHousehold");
  });
});

describe("removeHouseholdMember", () => {
  it("lets the admin remove a member", async () => {
    await create();
    await accept(bob, await invite());
    const result = await makeRemoveHouseholdMember(deps)({
      actorId: ann,
      memberId: bob,
    });
    expect(result.isOk).toBe(true);
    expect(await households.findByMember(bob)).toBeNull();
  });

  it("rejects a non-admin", async () => {
    await create();
    await accept(bob, await invite());
    const result = await makeRemoveHouseholdMember(deps)({
      actorId: bob,
      memberId: ann,
    });
    expect(result.isErr && result.error.code).toBe("NotHouseholdAdmin");
  });

  it("rejects an actor without a household", async () => {
    const result = await makeRemoveHouseholdMember(deps)({
      actorId: ann,
      memberId: bob,
    });
    expect(result.isErr && result.error.code).toBe("NotInHousehold");
  });
});
