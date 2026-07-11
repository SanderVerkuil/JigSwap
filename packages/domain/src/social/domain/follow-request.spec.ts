import { describe, expect, it } from "vitest";
import { toFollowRequestId, toMemberId } from "../../shared-kernel";
import { FollowRequest } from "./follow-request";

const requester = toMemberId("alice");
const target = toMemberId("bob");
const requestId = toFollowRequestId("req-1");
const NOW = new Date("2026-07-11T10:00:00Z");
const LATER = new Date("2026-07-12T10:00:00Z");

const pending = () => {
  const result = FollowRequest.request({
    id: requestId,
    requesterId: requester,
    targetId: target,
    now: NOW,
  });
  if (!result.isOk) throw new Error("setup");
  return result.value;
};

const declined = () => {
  const request = pending();
  if (request.decline(LATER).isErr) throw new Error("setup");
  request.pullEvents();
  return request;
};

describe("FollowRequest.request", () => {
  it("creates a pending request and records FollowRequested", () => {
    const request = pending();
    expect(request.status).toBe("pending");
    expect(request.requesterId).toBe(requester);
    expect(request.targetId).toBe(target);

    const events = request.pullEvents();
    expect(events.map((e) => e.name)).toEqual(["FollowRequested"]);
  });

  it("rejects a self-request", () => {
    const result = FollowRequest.request({
      id: requestId,
      requesterId: requester,
      targetId: requester,
      now: NOW,
    });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("SelfFollow");
  });

  it("drains events only once", () => {
    const request = pending();
    expect(request.pullEvents()).toHaveLength(1);
    expect(request.pullEvents()).toHaveLength(0);
  });
});

describe("FollowRequest.approve", () => {
  it("moves pending → approved, stamps respondedAt, records FollowRequestApproved", () => {
    const request = pending();
    request.pullEvents();

    const result = request.approve(LATER);
    expect(result.isOk).toBe(true);
    expect(request.status).toBe("approved");
    expect(request.toState().respondedAt).toBe(LATER);
    expect(request.pullEvents().map((e) => e.name)).toEqual([
      "FollowRequestApproved",
    ]);
  });

  it("rejects approving a non-pending request", () => {
    const request = pending();
    request.approve(LATER);
    const again = request.approve(LATER);
    expect(again.isErr).toBe(true);
    if (again.isErr) expect(again.error.code).toBe("RequestNotPending");
  });
});

describe("FollowRequest.decline", () => {
  it("moves pending → declined, stamps respondedAt, records FollowRequestDeclined", () => {
    const request = pending();
    request.pullEvents();

    const result = request.decline(LATER);
    expect(result.isOk).toBe(true);
    expect(request.status).toBe("declined");
    expect(request.toState().respondedAt).toBe(LATER);
    expect(request.pullEvents().map((e) => e.name)).toEqual([
      "FollowRequestDeclined",
    ]);
  });

  it("rejects declining a non-pending request", () => {
    const request = pending();
    request.decline(LATER);
    const again = request.decline(LATER);
    expect(again.isErr).toBe(true);
    if (again.isErr) expect(again.error.code).toBe("RequestNotPending");
  });
});

describe("FollowRequest.markCancelledWhileDeclined", () => {
  const CANCELLED_AT = new Date("2026-07-13T10:00:00Z");

  it("stamps cancelledAt on a declined request, keeps it declined, records no event", () => {
    const request = declined();

    const result = request.markCancelledWhileDeclined(CANCELLED_AT);
    expect(result.isOk).toBe(true);
    expect(request.status).toBe("declined");
    expect(request.toState().cancelledAt).toBe(CANCELLED_AT);
    expect(request.toState().respondedAt).toBe(LATER);
    expect(request.pullEvents()).toHaveLength(0);
  });

  it("rejects cancelling a pending request (RequestNotPending), leaving it unchanged", () => {
    const request = pending();
    request.pullEvents();

    const result = request.markCancelledWhileDeclined(CANCELLED_AT);
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("RequestNotPending");
    expect(request.status).toBe("pending");
    expect(request.toState().cancelledAt).toBeUndefined();
  });

  it("rejects cancelling an approved request (RequestNotPending)", () => {
    const request = pending();
    if (request.approve(LATER).isErr) throw new Error("setup");
    request.pullEvents();

    const result = request.markCancelledWhileDeclined(CANCELLED_AT);
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("RequestNotPending");
    expect(request.toState().cancelledAt).toBeUndefined();
  });
});

describe("FollowRequest.reopenAfterCancel", () => {
  const CANCELLED_AT = new Date("2026-07-13T10:00:00Z");

  it("clears cancelledAt, keeps the request declined, records no event", () => {
    const request = declined();
    if (request.markCancelledWhileDeclined(CANCELLED_AT).isErr) {
      throw new Error("setup");
    }
    expect(request.toState().cancelledAt).toBe(CANCELLED_AT);

    request.reopenAfterCancel();
    expect(request.toState().cancelledAt).toBeUndefined();
    expect(request.status).toBe("declined");
    expect(request.toState().respondedAt).toBe(LATER);
    expect(request.pullEvents()).toHaveLength(0);
  });
});

describe("FollowRequest rehydration", () => {
  it("round-trips through toState/rehydrate without re-emitting events", () => {
    const request = pending();
    const rehydrated = FollowRequest.rehydrate(request.toState());
    expect(rehydrated.id).toBe(requestId);
    expect(rehydrated.status).toBe("pending");
    expect(rehydrated.pullEvents()).toHaveLength(0);
  });
});
