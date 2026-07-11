import { beforeEach, describe, expect, it } from "vitest";
import { toMemberId } from "../../../shared-kernel";
import { Follow, FollowRequest, FollowRequestId } from "../../domain";
import {
  FixedClock,
  InMemoryFollowRepository,
  InMemoryFollowRequestRepository,
  RecordingEventPublisher,
  SequentialFollowIdGenerator,
  SequentialFollowRequestIdGenerator,
} from "../testing";
import { makeApproveFollowRequest } from "./approve-follow-request";
import { makeCancelFollowRequest } from "./cancel-follow-request";
import { makeDeclineFollowRequest } from "./decline-follow-request";
import { makeRequestFollow } from "./request-follow";

const alice = toMemberId("alice"); // requester
const bob = toMemberId("bob"); // target
const carol = toMemberId("carol"); // bystander
const NOW = new Date("2026-07-11T10:00:00Z");

describe("resolving follow requests", () => {
  let requests: InMemoryFollowRequestRepository;
  let follows: InMemoryFollowRepository;
  let events: RecordingEventPublisher;
  let requestId: FollowRequestId;
  let followIds: SequentialFollowIdGenerator;
  let approve: ReturnType<typeof makeApproveFollowRequest>;
  let decline: ReturnType<typeof makeDeclineFollowRequest>;
  let cancel: ReturnType<typeof makeCancelFollowRequest>;

  beforeEach(async () => {
    requests = new InMemoryFollowRequestRepository();
    follows = new InMemoryFollowRepository();
    events = new RecordingEventPublisher();
    const clock = new FixedClock(NOW);
    const request = makeRequestFollow({
      requests,
      follows,
      requestIds: new SequentialFollowRequestIdGenerator(),
      events,
      clock,
    });
    const created = await request({ requesterId: alice, targetId: bob });
    if (!created.isOk) throw new Error("setup");
    requestId = created.value;
    events.published.length = 0; // discard the FollowRequested from setup

    // Shared across the whole test (not recreated per `it`) so a test that seeds an extra Follow
    // edge before calling approve() draws from the same counter as approve's own id generator —
    // otherwise two independently-fresh generators both mint "follow-1" and the second save()
    // silently clobbers the first in the in-memory store (keyed by FollowId).
    followIds = new SequentialFollowIdGenerator();
    const deps = {
      requests,
      follows,
      followIds,
      events,
      clock,
    };
    approve = makeApproveFollowRequest(deps);
    decline = makeDeclineFollowRequest({ requests, events, clock });
    cancel = makeCancelFollowRequest({ requests });
  });

  it("approve: creates the requester→target edge and publishes both events", async () => {
    const result = await approve({ requestId, actorId: bob });
    expect(result.isOk).toBe(true);
    if (!result.isOk) return;

    expect(result.value.requesterId).toBe(alice);
    expect(result.value.alreadyFollowsBack).toBe(false);
    expect(await follows.find(alice, bob)).not.toBeNull();
    expect(events.names().sort()).toEqual([
      "FollowRequestApproved",
      "MemberFollowed",
    ]);
  });

  it("approve: reports alreadyFollowsBack when the target already follows the requester", async () => {
    const back = Follow.establish({
      id: followIds.next(),
      followerId: bob,
      followeeId: alice,
      now: NOW,
    });
    if (!back.isOk) throw new Error("setup");
    await follows.save(back.value);

    const result = await approve({ requestId, actorId: bob });
    expect(result.isOk).toBe(true);
    if (result.isOk) expect(result.value.alreadyFollowsBack).toBe(true);
    // The requester→target edge is genuinely new here (only the reverse edge pre-existed), so
    // both events fire, same as the plain approve case.
    expect(events.names().sort()).toEqual([
      "FollowRequestApproved",
      "MemberFollowed",
    ]);
  });

  it("approve: tolerates an already-existing requester→target edge (no duplicate edge, no extra MemberFollowed)", async () => {
    const stray = Follow.establish({
      id: followIds.next(),
      followerId: alice,
      followeeId: bob,
      now: NOW,
    });
    if (!stray.isOk) throw new Error("setup");
    await follows.save(stray.value);

    const result = await approve({ requestId, actorId: bob });
    expect(result.isOk).toBe(true);
    expect(follows.size()).toBe(1); // no second edge created
    expect(events.names()).toEqual(["FollowRequestApproved"]); // no MemberFollowed
  });

  it("approve: surfaces a SelfFollow error if the loaded request is (invalidly) self-targeted", async () => {
    // Contrives a state FollowRequest.request() itself would reject, to exercise the
    // duplicate-tolerant edge-creation's own error path (Follow.establish rejecting a
    // self-follow), which is otherwise unreachable through the public API.
    const corrupt = FollowRequest.rehydrate({
      id: requestId,
      requesterId: alice,
      targetId: alice,
      status: "pending",
      createdAt: NOW,
    });
    await requests.save(corrupt);

    const result = await approve({ requestId, actorId: alice });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("SelfFollow");
  });

  it("approve: only the target may approve", async () => {
    const result = await approve({ requestId, actorId: carol });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("NotRequestTarget");
    expect(await follows.find(alice, bob)).toBeNull();
  });

  it("approve: unknown request id", async () => {
    const result = await approve({
      requestId: "nope" as FollowRequestId,
      actorId: bob,
    });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("RequestNotFound");
  });

  it("decline: marks declined, publishes FollowRequestDeclined, creates no edge", async () => {
    const result = await decline({ requestId, actorId: bob });
    expect(result.isOk).toBe(true);
    expect(events.names()).toEqual(["FollowRequestDeclined"]);
    expect(await follows.find(alice, bob)).toBeNull();
    const row = await requests.findById(requestId);
    expect(row?.status).toBe("declined");
  });

  it("decline: only the target may decline", async () => {
    const result = await decline({ requestId, actorId: alice });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("NotRequestTarget");
  });

  it("decline: unknown request id", async () => {
    const result = await decline({
      requestId: "nope" as FollowRequestId,
      actorId: bob,
    });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("RequestNotFound");
  });

  it("decline: declining an already-resolved request fails (RequestNotPending)", async () => {
    const first = await decline({ requestId, actorId: bob });
    expect(first.isOk).toBe(true);

    const second = await decline({ requestId, actorId: bob });
    expect(second.isErr).toBe(true);
    if (second.isErr) expect(second.error.code).toBe("RequestNotPending");
  });

  it("cancel: the requester withdraws their pending request (row removed, no events)", async () => {
    const result = await cancel({ requestId, actorId: alice });
    expect(result.isOk).toBe(true);
    expect(await requests.findById(requestId)).toBeNull();
    expect(events.published).toHaveLength(0);
  });

  it("cancel: only the requester may cancel", async () => {
    const result = await cancel({ requestId, actorId: bob });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("NotRequestOwner");
  });

  it("cancel: unknown request id", async () => {
    const result = await cancel({
      requestId: "nope" as FollowRequestId,
      actorId: alice,
    });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("RequestNotFound");
  });

  it("approve after decline fails (RequestNotPending)", async () => {
    await decline({ requestId, actorId: bob });
    const result = await approve({ requestId, actorId: bob });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("RequestNotPending");
  });
});
