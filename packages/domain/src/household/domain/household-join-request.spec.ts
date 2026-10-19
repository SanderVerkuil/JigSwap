import { describe, expect, it } from "vitest";
import {
  toHouseholdId,
  toHouseholdJoinRequestId,
  toMemberId,
} from "../../shared-kernel";
import { Household, householdLeaveConsequence } from "./household";
import {
  HOUSEHOLD_JOIN_REQUEST_TTL_MS,
  HouseholdJoinRequest,
  type HouseholdJoinRequestLeave,
} from "./household-join-request";

const id = toHouseholdJoinRequestId("request-1");
const target = toHouseholdId("household-1");
const other = toHouseholdId("household-2");
const ann = toMemberId("ann");
const bob = toMemberId("bob");
const cat = toMemberId("cat");
const t0 = new Date("2026-10-01T00:00:00Z");
const t1 = new Date("2026-10-02T00:00:00Z");
const lapsed = new Date(t0.getTime() + HOUSEHOLD_JOIN_REQUEST_TTL_MS);

const requested = (
  props: { dropped?: boolean; leave?: HouseholdJoinRequestLeave } = {},
): HouseholdJoinRequest => {
  const result = HouseholdJoinRequest.request({
    id,
    householdId: target,
    requesterId: bob,
    adminId: ann,
    linkId: "link-1",
    dropped: props.dropped ?? false,
    leave: props.leave,
    now: t0,
  });
  if (result.isErr) throw result.error;
  result.value.pullEvents();
  return result.value;
};

const householdOf = (
  members: { memberId: typeof ann; role: "admin" | "member" }[],
): Household =>
  Household.rehydrate({
    id: other,
    createdAt: t0,
    members: members.map((m, i) => ({
      ...m,
      joinedAt: new Date(t0.getTime() + i),
    })),
  });

describe("HouseholdJoinRequest.request", () => {
  it("creates a pending request lapsing in 14 days and records HouseholdJoinRequested", () => {
    const result = HouseholdJoinRequest.request({
      id,
      householdId: target,
      requesterId: bob,
      adminId: ann,
      linkId: "link-1",
      dropped: false,
      now: t0,
    });
    if (result.isErr) throw result.error;
    const request = result.value;
    expect(request.status).toBe("pending");
    expect(request.toState().expiresAt).toEqual(lapsed);
    expect(request.toState().leave).toBeUndefined();
    expect(request.pullEvents().map((e) => e.name)).toEqual([
      "HouseholdJoinRequested",
    ]);
  });

  it("records nothing for a dropped request", () => {
    const result = HouseholdJoinRequest.request({
      id,
      householdId: target,
      requesterId: bob,
      adminId: ann,
      linkId: "link-1",
      dropped: true,
      now: t0,
    });
    if (result.isErr) throw result.error;
    expect(result.value.dropped).toBe(true);
    expect(result.value.pullEvents()).toEqual([]);
  });

  it("rejects asking the link's own admin", () => {
    const result = HouseholdJoinRequest.request({
      id,
      householdId: target,
      requesterId: ann,
      adminId: ann,
      linkId: "link-1",
      dropped: false,
      now: t0,
    });
    expect(result.isErr && result.error.code).toBe("SelfJoinRequest");
  });
});

describe("HouseholdJoinRequest answers", () => {
  it("approves a pending request and records the approver", () => {
    const request = requested();
    expect(request.approve(ann, t1).isOk).toBe(true);
    expect(request.status).toBe("approved");
    const [event] = request.pullEvents();
    expect(event).toMatchObject({
      name: "HouseholdJoinRequestApproved",
      requesterId: bob,
      approverId: ann,
    });
  });

  it("refuses to approve a lapsed, dropped or answered request", () => {
    expect(requested().approve(ann, lapsed).isErr).toBe(true);
    expect(requested({ dropped: true }).approve(ann, t1).isErr).toBe(true);
    const declined = requested();
    declined.decline(t1);
    const result = declined.approve(ann, t1);
    expect(result.isErr && result.error.code).toBe("JoinRequestNotPending");
  });

  it("declines silently", () => {
    const request = requested();
    expect(request.decline(t1).isOk).toBe(true);
    expect(request.status).toBe("declined");
    expect(request.pullEvents()).toEqual([]);
  });

  it("stays open to the requester after a decline, and they may withdraw it", () => {
    const request = requested();
    request.decline(t1);
    expect(request.isOpen(t1)).toBe(true);
    expect(request.isActionable(t1)).toBe(false);
    expect(request.withdraw(bob, t1).isOk).toBe(true);
    expect(request.status).toBe("withdrawn");
    expect(request.isOpen(t1)).toBe(false);
  });

  it("lets only the requester withdraw, while open", () => {
    const result = requested().withdraw(cat, t1);
    expect(result.isErr && result.error.code).toBe("NotRequester");
    const late = requested().withdraw(bob, lapsed);
    expect(late.isErr && late.error.code).toBe("JoinRequestNotPending");
  });

  it("voids a pending request for good", () => {
    const request = requested();
    expect(request.void(t1).isOk).toBe(true);
    expect(request.status).toBe("void");
    expect(request.isOpen(t1)).toBe(false);
    expect(request.void(t1).isErr).toBe(true);
  });
});

describe("HouseholdJoinRequest.consentHolds", () => {
  it("holds without consent only while the requester is in no household", () => {
    const request = requested();
    expect(request.consentHolds(null)).toBe(true);
    expect(
      request.consentHolds(householdOf([{ memberId: bob, role: "admin" }])),
    ).toBe(false);
  });

  it("holds while the requester is in the agreed household with the same consequence", () => {
    const request = requested({
      leave: { householdId: other, consequence: "deleted" },
    });
    expect(request.consentHolds(null)).toBe(false);
    expect(
      request.consentHolds(householdOf([{ memberId: bob, role: "admin" }])),
    ).toBe(true);
    // A housemate joined: leaving now hands the household over instead of deleting it.
    expect(
      request.consentHolds(
        householdOf([
          { memberId: bob, role: "admin" },
          { memberId: cat, role: "member" },
        ]),
      ),
    ).toBe(false);
  });
});

describe("householdLeaveConsequence", () => {
  it("deletes for the last member, hands over for a sole admin, else leaves", () => {
    expect(
      householdLeaveConsequence([{ memberId: bob, role: "admin" }], bob),
    ).toBe("deleted");
    expect(
      householdLeaveConsequence(
        [
          { memberId: bob, role: "admin" },
          { memberId: cat, role: "member" },
        ],
        bob,
      ),
    ).toBe("handover");
    expect(
      householdLeaveConsequence(
        [
          { memberId: bob, role: "member" },
          { memberId: cat, role: "admin" },
        ],
        bob,
      ),
    ).toBe("leave");
    expect(
      householdLeaveConsequence(
        [
          { memberId: bob, role: "admin" },
          { memberId: cat, role: "admin" },
        ],
        bob,
      ),
    ).toBe("leave");
  });
});
