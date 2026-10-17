import { describe, expect, it } from "vitest";
import { toId, toMemberId } from "../../shared-kernel";
import { HouseholdInviteDeclined } from "./events";
import { HouseholdInvite } from "./household-invite";
import { HouseholdId, HouseholdInviteId } from "./ids";

const id = toId<"HouseholdInviteId">("invite-1") as HouseholdInviteId;
const householdId = toId<"HouseholdId">("household-1") as HouseholdId;
const ann = toMemberId("ann");
const bob = toMemberId("bob");
const t0 = new Date("2026-10-01T00:00:00Z");
const t1 = new Date("2026-10-02T00:00:00Z");

const sent = (): HouseholdInvite => {
  const result = HouseholdInvite.send({
    id,
    householdId,
    inviterId: ann,
    inviteeId: bob,
    now: t0,
  });
  if (result.isErr) throw result.error;
  result.value.pullEvents();
  return result.value;
};

describe("HouseholdInvite.send", () => {
  it("creates a pending invite and records HouseholdInviteSent", () => {
    const result = HouseholdInvite.send({
      id,
      householdId,
      inviterId: ann,
      inviteeId: bob,
      now: t0,
    });
    expect(result.isOk).toBe(true);
    if (result.isErr) return;
    expect(result.value.status).toBe("pending");
    expect(result.value.id).toBe(id);
    expect(result.value.householdId).toBe(householdId);
    expect(result.value.inviterId).toBe(ann);
    expect(result.value.inviteeId).toBe(bob);
    expect(result.value.pullEvents().map((e) => e.name)).toEqual([
      "HouseholdInviteSent",
    ]);
  });

  it("rejects inviting yourself", () => {
    const result = HouseholdInvite.send({
      id,
      householdId,
      inviterId: ann,
      inviteeId: ann,
      now: t0,
    });
    expect(result.isErr && result.error.code).toBe("SelfInvite");
  });
});

describe("HouseholdInvite.accept / decline", () => {
  it("lets only the invitee accept, once", () => {
    const invite = sent();
    const byOther = invite.accept(ann, t1);
    expect(byOther.isErr && byOther.error.code).toBe("NotInvitee");

    expect(invite.accept(bob, t1).isOk).toBe(true);
    expect(invite.status).toBe("accepted");
    expect(invite.pullEvents().map((e) => e.name)).toEqual([
      "HouseholdInviteAccepted",
    ]);

    const again = invite.decline(bob, t1);
    expect(again.isErr && again.error.code).toBe("InviteNotPending");
  });

  it("lets the invitee decline", () => {
    const invite = sent();
    const byOther = invite.decline(ann, t1);
    expect(byOther.isErr && byOther.error.code).toBe("NotInvitee");
    expect(invite.decline(bob, t1).isOk).toBe(true);
    expect(invite.status).toBe("declined");
    expect(invite.toState().respondedAt).toEqual(t1);
  });

  it("records HouseholdInviteDeclined with the invite's parties", () => {
    const invite = sent();
    expect(invite.decline(bob, t1).isOk).toBe(true);
    const events = invite.pullEvents();
    expect(events.map((e) => e.name)).toEqual(["HouseholdInviteDeclined"]);
    expect(events).toEqual([
      new HouseholdInviteDeclined(id, householdId, ann, bob, t1),
    ]);
  });
});
