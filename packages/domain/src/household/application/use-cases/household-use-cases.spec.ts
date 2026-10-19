import { beforeEach, describe, expect, it } from "vitest";
import {
  makeAcceptHouseholdInvite,
  makeCreateHousehold,
  makeDeclineHouseholdInvite,
  makeInviteToHousehold,
  makeJoinHouseholdByLink,
  makeLeaveHousehold,
  makeRemoveHouseholdMember,
  makeRenameHousehold,
  makeSetHouseholdDefaultCopyPermission,
} from ".";
import { toMemberId } from "../../../shared-kernel";
import { HouseholdId, HouseholdInviteId, MemberId } from "../../domain";
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

  it("invites someone who is in another household (they choose on accept)", async () => {
    await create();
    await create(bob);
    const id = await invite();
    expect((await invites.findById(id))?.status).toBe("pending");
  });

  it("rejects inviting someone already in this household", async () => {
    await create();
    await accept(bob, await invite());
    const result = await makeInviteToHousehold(deps)({
      actorId: ann,
      inviteeId: bob,
    });
    expect(result.isErr && result.error.code).toBe("AlreadyMember");
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

  it("rejects inviting yourself (you are already in your household)", async () => {
    await create();
    const result = await makeInviteToHousehold(deps)({
      actorId: ann,
      inviteeId: ann,
    });
    expect(result.isErr && result.error.code).toBe("AlreadyMember");
    expect(events.names()).not.toContain("HouseholdInviteSent");
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

  it("rejects without persisting when the household already lists the invitee", async () => {
    // A stale membership lookup misses the invitee, but the household itself already holds them.
    class StaleMembershipLookup extends InMemoryHouseholdRepository {
      override async findByMember(memberId: MemberId) {
        return memberId === bob ? null : super.findByMember(memberId);
      }
    }
    deps.households = households = new StaleMembershipLookup();
    const householdId = await create();
    const inviteId = await invite();
    const household = await households.findById(householdId);
    household?.admit(bob, clock.now());
    if (household) await households.save(household);
    events.published.length = 0;

    const result = await accept(bob, inviteId);
    expect(result.isErr && result.error.code).toBe("AlreadyMember");
    expect((await invites.findById(inviteId))?.status).toBe("pending");
    expect(events.published).toEqual([]);
  });

  describe("leaving the current household (leaveCurrentHousehold)", () => {
    const switchTo = (actorId: MemberId, inviteId: HouseholdInviteId) =>
      makeAcceptHouseholdInvite(deps)({
        actorId,
        inviteId,
        leaveCurrentHousehold: true,
      });

    it("a sole member's household is dissolved with its pending invites, then they join", async () => {
      const annHousehold = await create();
      const bobHousehold = await create(bob);
      const bobsOwnInvite = await invite(bob, cat);
      const inviteId = await invite();
      events.published.length = 0;

      const result = await switchTo(bob, inviteId);
      expect(result.isOk && result.value).toBe(annHousehold);
      expect(await households.findById(bobHousehold)).toBeNull();
      expect(await invites.findById(bobsOwnInvite)).toBeNull();
      expect((await households.findByMember(bob))?.id).toBe(annHousehold);
      expect(events.names()).toEqual([
        "HouseholdMemberLeft",
        "HouseholdDissolved",
        "HouseholdInviteAccepted",
        "HouseholdMemberJoined",
      ]);
    });

    it("an admin with housemates leaves (longest-standing member takes over) and joins", async () => {
      const annHousehold = await create();
      const bobHousehold = await create(bob);
      await accept(cat, await invite(bob, cat));
      const inviteId = await invite();

      expect((await switchTo(bob, inviteId)).isOk).toBe(true);
      const left = await households.findById(bobHousehold);
      expect(left?.isMember(bob)).toBe(false);
      expect(left?.isAdmin(cat)).toBe(true);
      expect((await households.findById(annHousehold))?.isMember(bob)).toBe(
        true,
      );
    });

    it("without the flag nothing changes", async () => {
      await create();
      const bobHousehold = await create(bob);
      const inviteId = await invite();
      events.published.length = 0;

      const result = await accept(bob, inviteId);
      expect(result.isErr && result.error.code).toBe("AlreadyInHousehold");
      expect((await households.findByMember(bob))?.id).toBe(bobHousehold);
      expect((await invites.findById(inviteId))?.status).toBe("pending");
      expect(events.published).toEqual([]);
    });

    it("refuses without leaving when the target household is gone", async () => {
      await create();
      const bobHousehold = await create(bob);
      const inviteId = await invite();
      const stale = await invites.findById(inviteId);
      await makeLeaveHousehold(deps)({ actorId: ann });
      if (stale) await invites.save(stale);
      events.published.length = 0;

      const result = await switchTo(bob, inviteId);
      expect(result.isErr && result.error.code).toBe("HouseholdNotFound");
      expect((await households.findById(bobHousehold))?.isMember(bob)).toBe(
        true,
      );
      expect(events.published).toEqual([]);
    });

    it("refuses without leaving when the invite was already answered", async () => {
      await create();
      const bobHousehold = await create(bob);
      const inviteId = await invite();
      await makeDeclineHouseholdInvite(deps)({ actorId: bob, inviteId });

      const result = await switchTo(bob, inviteId);
      expect(result.isErr && result.error.code).toBe("InviteNotPending");
      expect((await households.findById(bobHousehold))?.isMember(bob)).toBe(
        true,
      );
    });
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

  it("rejects an unknown invite", async () => {
    const result = await makeDeclineHouseholdInvite(deps)({
      actorId: bob,
      inviteId: "nope" as HouseholdInviteId,
    });
    expect(result.isErr && result.error.code).toBe("InviteNotFound");
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

  it("relays the domain's rejection when the found household does not list the actor", async () => {
    // A stale membership lookup returns a household the actor is no longer in.
    class StaleMembershipLookup extends InMemoryHouseholdRepository {
      override async findByMember() {
        return this.findById("household-1" as HouseholdId);
      }
    }
    deps.households = households = new StaleMembershipLookup();
    const householdId = await create();
    events.published.length = 0;

    const result = await makeLeaveHousehold(deps)({ actorId: cat });
    expect(result.isErr && result.error.code).toBe("NotAMember");
    expect((await households.findById(householdId))?.isMember(ann)).toBe(true);
    expect(events.published).toEqual([]);
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

describe("setHouseholdDefaultCopyPermission", () => {
  const setDefault = (actorId: MemberId, permission: "manage" | "view") =>
    makeSetHouseholdDefaultCopyPermission(deps)({ actorId, permission });

  it("lets the admin set the household default and persists it", async () => {
    const id = await create();
    const publishedBefore = events.published.length;
    expect(await setDefault(ann, "view")).toEqual({
      isOk: true,
      isErr: false,
      value: { changed: true },
    });
    expect(
      (await households.findById(id))?.toState().defaultCopyPermission,
    ).toBe("view");
    expect(events.published.length).toBe(publishedBefore);
  });

  it("rejects a non-admin member without saving", async () => {
    const id = await create();
    await accept(bob, await invite());
    const result = await setDefault(bob, "view");
    expect(result.isErr && result.error.code).toBe("NotHouseholdAdmin");
    expect(
      (await households.findById(id))?.toState().defaultCopyPermission,
    ).toBeUndefined();
  });

  it("rejects an actor without a household", async () => {
    const result = await setDefault(cat, "view");
    expect(result.isErr && result.error.code).toBe("NotInHousehold");
  });
});

describe("renameHousehold", () => {
  const rename = (actorId: MemberId, name: string | null) =>
    makeRenameHousehold(deps)({ actorId, name });
  const nameOf = async (id: HouseholdId) =>
    (await households.findById(id))?.toState().name;

  it("lets the admin name the household, normalised, without events", async () => {
    const id = await create();
    const publishedBefore = events.published.length;
    expect((await rename(ann, "  The\t Smiths\u200B ")).isOk).toBe(true);
    expect(await nameOf(id)).toBe("The Smiths");
    expect(events.published.length).toBe(publishedBefore);
  });

  it("clears the name with null", async () => {
    const id = await create();
    await rename(ann, "Home");
    expect((await rename(ann, null)).isOk).toBe(true);
    expect(await nameOf(id)).toBeUndefined();
  });

  it("accepts 100 characters and rejects 101 or an invisible name", async () => {
    const id = await create();
    expect((await rename(ann, "a".repeat(100))).isOk).toBe(true);
    for (const bad of ["a".repeat(101), "   ", "\u200B\u200B", ""]) {
      const result = await rename(ann, bad);
      expect(result.isErr && result.error.code).toBe("InvalidHouseholdName");
    }
    expect(await nameOf(id)).toBe("a".repeat(100));
  });

  it("rejects a non-admin member without saving", async () => {
    const id = await create();
    await accept(bob, await invite());
    const result = await rename(bob, "Bob's place");
    expect(result.isErr && result.error.code).toBe("NotHouseholdAdmin");
    expect(await nameOf(id)).toBeUndefined();
  });

  it("rejects an actor without a household", async () => {
    const result = await rename(cat, "Home");
    expect(result.isErr && result.error.code).toBe("NotInHousehold");
  });
});

describe("joinHouseholdByLink", () => {
  const join = (actorId: MemberId, inviterId: MemberId = ann) =>
    makeJoinHouseholdByLink(deps)({ actorId, inviterId });

  it("joins the inviter's household through an accepted invite", async () => {
    const householdId = await create();
    events.published.length = 0;

    const result = await join(bob);
    expect(result.isOk && result.value).toBe(householdId);
    expect((await households.findById(householdId))?.isMember(bob)).toBe(true);
    const stored = await invites.findById(
      "household-invite-1" as HouseholdInviteId,
    );
    expect(stored?.status).toBe("accepted");
    expect(stored?.inviterId).toBe(ann);
    expect(stored?.inviteeId).toBe(bob);
  });

  it("publishes the acceptance and the join, but no invite-sent event", async () => {
    await create();
    events.published.length = 0;
    await join(bob);
    expect(events.names()).toEqual([
      "HouseholdInviteAccepted",
      "HouseholdMemberJoined",
    ]);
  });

  it("accepts an invite already pending from that household instead of a duplicate", async () => {
    const householdId = await create();
    const pendingId = await invite();
    events.published.length = 0;

    const result = await join(bob);
    expect(result.isOk && result.value).toBe(householdId);
    expect((await invites.findById(pendingId))?.status).toBe("accepted");
    expect(
      await invites.findById("household-invite-2" as HouseholdInviteId),
    ).toBeNull();
    expect(events.names()).toEqual([
      "HouseholdInviteAccepted",
      "HouseholdMemberJoined",
    ]);
  });

  it("rejects a member who is already in a household, publishing nothing", async () => {
    await create();
    await create(bob);
    events.published.length = 0;
    const result = await join(bob);
    expect(result.isErr && result.error.code).toBe("AlreadyInHousehold");
    expect(events.published).toEqual([]);
  });

  it("switches a member of another household who asked to leave it", async () => {
    const annHousehold = await create();
    const bobHousehold = await create(bob);
    events.published.length = 0;
    const result = await makeJoinHouseholdByLink(deps)({
      actorId: bob,
      inviterId: ann,
      leaveCurrentHousehold: true,
    });
    expect(result.isOk && result.value).toBe(annHousehold);
    expect(await households.findById(bobHousehold)).toBeNull();
    expect(events.names()).not.toContain("HouseholdInviteSent");
  });

  it("rejects an inviter who is no longer the admin", async () => {
    await create();
    await accept(bob, await invite());
    events.published.length = 0;
    const result = await join(cat, bob);
    expect(result.isErr && result.error.code).toBe("NotHouseholdAdmin");
    expect(events.published).toEqual([]);
  });

  it("rejects an inviter without a household", async () => {
    const result = await join(bob);
    expect(result.isErr && result.error.code).toBe("NotInHousehold");
    expect(events.published).toEqual([]);
  });
});
