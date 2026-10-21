import { describe, expect, it } from "vitest";
import {
  toCircleId,
  toCircleInviteId,
  toCopyId,
  toMemberId,
  toMembershipId,
} from "../../shared-kernel";
import {
  Circle,
  MAX_CIRCLE_MEMBERS,
  MAX_CIRCLE_NAME_LENGTH,
  type CreateCircleProps,
} from "./circle";
import { CircleInvite } from "./circle-invite";
import { CircleDeleted, MemberJoinedCircle, MemberLeftCircle } from "./events";
import { CircleId, MembershipId } from "./ids";

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

// Circle.create, unwrapped; a refusal fails the test setup.
const created = (props: CreateCircleProps): Circle => {
  const result = Circle.create(props);
  if (!result.isOk) throw new Error("setup: create failed");
  return result.value;
};

const newCircle = (): Circle =>
  created({
    id: circleId,
    ownerId: owner,
    ownerMembershipId: membershipId(),
    name: "Family",
    now: NOW,
  });

describe("Circle", () => {
  it("opens with the owner as its only member, implicitly Admin", () => {
    const ownerMembershipId = membershipId();
    const circle = created({
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

  describe("create: name", () => {
    const createNamed = (name: string) =>
      Circle.create({
        id: circleId,
        ownerId: owner,
        ownerMembershipId: membershipId(),
        name,
        now: NOW,
      });

    it("caps a name at 100 characters", () => {
      expect(MAX_CIRCLE_NAME_LENGTH).toBe(100);
    });

    it("stores the name trimmed", () => {
      const result = createNamed("  Family  ");
      expect(result.isOk && result.value.name).toBe("Family");
    });

    it("accepts 1 and exactly 100 characters, counted after trimming", () => {
      for (const name of ["F", "x".repeat(100), ` ${"x".repeat(100)} `]) {
        const result = createNamed(name);
        expect(result.isOk && result.value.name).toBe(name.trim());
      }
    });

    it("refuses an empty, whitespace-only or 101-character name with InvalidCircleName", () => {
      for (const name of ["", "   \t\n", "x".repeat(101)]) {
        const result = createNamed(name);
        expect(result.isErr && result.error.code).toBe("InvalidCircleName");
      }
    });

    it("drops bidi overrides and isolates from a new name", () => {
      const result = createNamed("\u202Egnp.exe \u2066Family\u2069");
      expect(result.isOk && result.value.name).toBe("gnp.exe Family");
    });

    it("drops zero-width spaces, word joiners and BOMs", () => {
      const result = createNamed("\u200B Fam\u2060il\u200By\uFEFF ");
      expect(result.isOk && result.value.name).toBe("Family");
    });

    it("turns control characters into single spaces", () => {
      for (const [name, stored] of [
        ["a\tb\nc", "a b c"],
        ["a\u0000b", "a b"],
        ["a \t\r\n  b", "a b"],
        ["a\u200B \u200B b", "a b"],
      ]) {
        const result = createNamed(name);
        expect(result.isOk && result.value.name).toBe(stored);
      }
    });

    it("keeps ZWJ and ZWNJ: an emoji family stays one family, a Persian word keeps its ZWNJ", () => {
      for (const name of [
        "\u{1F468}\u200D\u{1F469}\u200D\u{1F467} puzzlers",
        "\u0645\u06CC\u200C\u062E\u0648\u0627\u0647\u0645",
      ]) {
        const result = createNamed(name);
        expect(result.isOk && result.value.name).toBe(name);
      }
    });

    it("refuses a name with nothing visible with InvalidCircleName", () => {
      for (const name of [
        "\u200B\u200C\u200D\uFEFF",
        " \u200B \u2060 ",
        "\u200D",
        "\u200C\u200D \u200C",
        "\u0301",
      ]) {
        const result = createNamed(name);
        expect(result.isErr && result.error.code).toBe("InvalidCircleName");
      }
    });

    it("accepts a single visible letter, digit, symbol or punctuation mark", () => {
      for (const name of ["F", "7", "🧩", "&"]) {
        expect(createNamed(name).isOk).toBe(true);
      }
    });

    it("measures the 100-character limit after dropping invisible characters", () => {
      const name = "x".repeat(100);
      const result = createNamed(`${name}\u200B\u200B\u202E`);
      expect(result.isOk && result.value.name).toBe(name);
    });

    it("keeps accents and emoji intact", () => {
      for (const name of [
        "Puzzelclub Zoë & Renée",
        "Café Crème",
        "Puzzels 🧩❤️👍🏽🇳🇱",
      ]) {
        const result = createNamed(name);
        expect(result.isOk && result.value.name).toBe(name);
      }
    });

    it("rehydrates a stored name longer than the limit without re-checking it", () => {
      const long = "x".repeat(150);
      const circle = Circle.rehydrate({ ...newCircle().toState(), name: long });
      expect(circle.name).toBe(long);
      // Nor strips a stored name's invisible characters.
      const odd = "Fam\u200Bily\u202E";
      expect(
        Circle.rehydrate({ ...newCircle().toState(), name: odd }).name,
      ).toBe(odd);
      expect(circle.delete(owner, long, NOW).isOk).toBe(true);
    });
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

  describe("delete", () => {
    it("lets the owner delete by typing the exact name, naming every other member", () => {
      const circle = newCircle();
      circle.addMember(owner, membershipId(), alice, "Admin", NOW);
      circle.addMember(owner, membershipId(), bob, "ViewOnly", NOW);
      circle.pullEvents();

      const result = circle.delete(owner, "Family", NOW);

      expect(result.isOk).toBe(true);
      const events = circle.pullEvents();
      expect(events).toHaveLength(1);
      const event = events[0] as CircleDeleted;
      expect(event).toBeInstanceOf(CircleDeleted);
      expect(event.name).toBe("CircleDeleted");
      expect(event.circleId).toBe(circleId);
      expect(event.ownerId).toBe(owner);
      expect(event.memberIds).toEqual([alice, bob]);
      expect(event.circleName).toBe("Family");
      expect(event.occurredAt).toBe(NOW);
    });

    it("names no one when the owner is alone", () => {
      const circle = newCircle();
      circle.pullEvents();

      expect(circle.delete(owner, "Family", NOW).isOk).toBe(true);
      expect((circle.pullEvents()[0] as CircleDeleted).memberIds).toEqual([]);
    });

    it("refuses an Admin who is not the owner", () => {
      const circle = newCircle();
      circle.addMember(owner, membershipId(), alice, "Admin", NOW);
      circle.pullEvents();

      const result = circle.delete(alice, "Family", NOW);

      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("NotCircleOwner");
      expect(circle.pullEvents()).toHaveLength(0);
    });

    it("refuses a non-member as NotAMember, before looking at the name", () => {
      const circle = newCircle();
      circle.pullEvents();

      const result = circle.delete(stranger, "wrong", NOW);

      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("NotAMember");
      expect(circle.pullEvents()).toHaveLength(0);
    });

    it.each(["family", "Family ", " Family", ""])(
      "refuses the owner when the confirmation is %j",
      (confirmName) => {
        const circle = newCircle();
        circle.pullEvents();

        const result = circle.delete(owner, confirmName, NOW);

        expect(result.isErr).toBe(true);
        if (result.isErr) {
          expect(result.error.code).toBe("ConfirmationMismatch");
        }
        expect(circle.pullEvents()).toHaveLength(0);
      },
    );
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

  describe("handOverOwnership", () => {
    it("makes a member the owner at Admin and keeps the old owner's seat", () => {
      const circle = newCircle();
      circle.addMember(owner, membershipId(), alice, "ViewOnly", NOW);
      const aliceSeat = circle.members.find((m) => m.memberId === alice)!;
      circle.pullEvents();

      const result = circle.handOverOwnership(alice);

      expect(result.isOk).toBe(true);
      expect(circle.ownerId).toBe(alice);
      expect(circle.toState().ownerId).toBe(alice);
      const newSeat = circle.members.find((m) => m.memberId === alice)!;
      expect(newSeat.permission).toBe("Admin");
      // Same seat: identity and join time are kept.
      expect(newSeat.id).toBe(aliceSeat.id);
      expect(newSeat.joinedAt).toBe(aliceSeat.joinedAt);
      // The old owner's seat stays as it was.
      expect(circle.isMember(owner)).toBe(true);
      expect(circle.members).toHaveLength(2);
      // A state change like changePermission: no event.
      expect(circle.pullEvents()).toEqual([]);
    });

    it("lets the new owner act as owner, and the old owner be removed", () => {
      const circle = newCircle();
      circle.addMember(owner, membershipId(), alice, "Exchange", NOW);
      circle.handOverOwnership(alice);

      expect(circle.leave(alice, NOW).isErr).toBe(true);
      expect(circle.removeMember(alice, owner, NOW).isOk).toBe(true);
    });

    it("rejects a non-member", () => {
      const circle = newCircle();
      const result = circle.handOverOwnership(stranger);
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("NotAMember");
      expect(circle.ownerId).toBe(owner);
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

    it("lets an Exchange member share", () => {
      const circle = newCircle();
      circle.addMember(owner, membershipId(), alice, "Exchange", NOW);
      circle.pullEvents();

      const result = circle.shareCopy(alice, copyId, NOW);
      expect(result.isOk).toBe(true);
      expect(circle.pullEvents().map((e) => e.name)).toEqual([
        "CopySharedToCircle",
      ]);
    });

    it("rejects a ViewOnly member", () => {
      const circle = newCircle();
      circle.addMember(owner, membershipId(), alice, "ViewOnly", NOW);
      circle.pullEvents();

      const result = circle.shareCopy(alice, copyId, NOW);
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("CannotShareCopy");
      expect(circle.pullEvents()).toHaveLength(0);
    });

    it("rejects a non-member", () => {
      const circle = newCircle();
      circle.pullEvents();

      const result = circle.shareCopy(stranger, copyId, NOW);
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("CannotShareCopy");
    });
  });

  describe("isAdmin", () => {
    it("is true for the owner and Admin members only", () => {
      const circle = newCircle();
      circle.addMember(owner, membershipId(), alice, "Admin", NOW);
      circle.addMember(owner, membershipId(), bob, "Exchange", NOW);
      expect(circle.isAdmin(owner)).toBe(true);
      expect(circle.isAdmin(alice)).toBe(true);
      expect(circle.isAdmin(bob)).toBe(false);
      expect(circle.isAdmin(stranger)).toBe(false);
    });
  });

  describe("admitInvitee", () => {
    // An invite from `inviterId` to `stranger`, accepted unless told otherwise.
    const inviteFrom = (
      inviterId = owner,
      opts: { accept?: boolean; circle?: CircleId } = {},
    ): CircleInvite => {
      const issued = CircleInvite.issue({
        id: toCircleInviteId("invite-1"),
        circleId: opts.circle ?? circleId,
        inviterId,
        inviteeId: stranger,
        permission: "Exchange",
        now: NOW,
      });
      if (!issued.isOk) throw new Error("setup: issue failed");
      if (opts.accept !== false) issued.value.accept(stranger, NOW);
      return issued.value;
    };

    it("seats the invitee at the invite's permission and records MemberJoinedCircle", () => {
      const circle = newCircle();
      circle.pullEvents();
      const id = membershipId();

      const result = circle.admitInvitee(inviteFrom(), id, NOW);

      expect(result.isOk).toBe(true);
      const seat = circle.members.find((m) => m.memberId === stranger);
      expect(seat?.id).toBe(id);
      expect(seat?.permission).toBe("Exchange");
      expect(circle.pullEvents()).toEqual([
        new MemberJoinedCircle(circleId, stranger, NOW),
      ]);
    });

    it("refuses an invite that is not accepted, or is for another circle", () => {
      const circle = newCircle();
      circle.pullEvents();
      for (const invite of [
        inviteFrom(owner, { accept: false }),
        inviteFrom(owner, { circle: toCircleId("circle-2") }),
      ]) {
        const result = circle.admitInvitee(invite, membershipId(), NOW);
        expect(result.isErr && result.error.code).toBe("InviteNotAccepted");
      }
      expect(circle.isMember(stranger)).toBe(false);
      expect(circle.pullEvents()).toEqual([]);
    });

    it("refuses when the inviter is no longer an Admin of the circle", () => {
      const circle = newCircle();
      circle.addMember(owner, membershipId(), alice, "Admin", NOW);
      circle.changePermission(owner, alice, "ViewOnly");
      circle.pullEvents();

      const result = circle.admitInvitee(
        inviteFrom(alice),
        membershipId(),
        NOW,
      );

      expect(result.isErr && result.error.code).toBe("NotCircleAdmin");
      expect(circle.isMember(stranger)).toBe(false);
      expect(circle.pullEvents()).toEqual([]);
    });

    it("refuses an invitee who already belongs, and a full circle", () => {
      const member = newCircle();
      member.addMember(owner, membershipId(), stranger, "ViewOnly", NOW);
      const again = member.admitInvitee(inviteFrom(), membershipId(), NOW);
      expect(again.isErr && again.error.code).toBe("AlreadyMember");

      const full = newCircle();
      for (let i = 1; i < MAX_CIRCLE_MEMBERS; i += 1) {
        full.addMember(
          owner,
          membershipId(),
          toMemberId(`m-${i}`),
          "ViewOnly",
          NOW,
        );
      }
      const result = full.admitInvitee(inviteFrom(), membershipId(), NOW);
      expect(result.isErr && result.error.code).toBe("CircleFull");
      expect(full.isMember(stranger)).toBe(false);
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
