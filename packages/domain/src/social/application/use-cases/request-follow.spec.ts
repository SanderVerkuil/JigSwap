import { beforeEach, describe, expect, it, vi } from "vitest";
import { toMemberId } from "../../../shared-kernel";
import { Follow, FollowRequest } from "../../domain";
import {
  FixedClock,
  InMemoryFollowRepository,
  InMemoryFollowRequestRepository,
  RecordingEventPublisher,
  SequentialFollowIdGenerator,
  SequentialFollowRequestIdGenerator,
} from "../testing";
import { makeCancelFollowRequest } from "./cancel-follow-request";
import {
  COOLDOWN_MS,
  makeRequestFollow,
  readsAsPendingToRequester,
} from "./request-follow";

const alice = toMemberId("alice");
const bob = toMemberId("bob");
const NOW = new Date("2026-07-11T10:00:00Z");

describe("makeRequestFollow", () => {
  let requests: InMemoryFollowRequestRepository;
  let follows: InMemoryFollowRepository;
  let events: RecordingEventPublisher;
  let requestIds: SequentialFollowRequestIdGenerator;
  let request: ReturnType<typeof makeRequestFollow>;

  // NOTE: requestIds is created once in beforeEach and reused across build() calls, not
  // recreated here. Re-creating it per build() would reset the id counter to 1 every time a
  // test advances the clock, making a genuinely "fresh" request collide with the id of the
  // stale one it replaced — a false pass/fail independent of the use case under test.
  const build = (now: Date) => {
    request = makeRequestFollow({
      requests,
      follows,
      requestIds,
      events,
      clock: new FixedClock(now),
    });
  };

  beforeEach(() => {
    requests = new InMemoryFollowRequestRepository();
    follows = new InMemoryFollowRepository();
    events = new RecordingEventPublisher();
    requestIds = new SequentialFollowRequestIdGenerator();
    build(NOW);
  });

  it("creates a pending request and publishes FollowRequested", async () => {
    const result = await request({ requesterId: alice, targetId: bob });
    expect(result.isOk).toBe(true);
    expect(requests.size()).toBe(1);
    expect(events.names()).toEqual(["FollowRequested"]);
  });

  it("is idempotent while a request is pending: returns the same id, no new row/event", async () => {
    const first = await request({ requesterId: alice, targetId: bob });
    const second = await request({ requesterId: alice, targetId: bob });
    expect(second.isOk).toBe(true);
    if (first.isOk && second.isOk) expect(second.value).toBe(first.value);
    expect(requests.size()).toBe(1);
    expect(events.names()).toEqual(["FollowRequested"]); // only the first
  });

  it("rejects when the requester already follows the target", async () => {
    const edge = Follow.establish({
      id: new SequentialFollowIdGenerator().next(),
      followerId: alice,
      followeeId: bob,
      now: NOW,
    });
    if (!edge.isOk) throw new Error("setup");
    await follows.save(edge.value);

    const result = await request({ requesterId: alice, targetId: bob });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("AlreadyFollowing");
  });

  it("silently no-ops during the decline cooldown (indistinguishable from pending)", async () => {
    const first = await request({ requesterId: alice, targetId: bob });
    if (!first.isOk) throw new Error("setup");
    const row = await requests.findByPair(alice, bob);
    if (!row) throw new Error("setup");
    row.decline(NOW);
    await requests.save(row);

    // A non-cancelled cooldown request must be a PURE read: the row is left exactly as-is, so
    // the use case must not re-save it (only the cancelled-row reopen path saves).
    const saveSpy = vi.spyOn(requests, "save");
    build(new Date(NOW.getTime() + COOLDOWN_MS - 1000)); // still inside cooldown
    const again = await request({ requesterId: alice, targetId: bob });
    expect(again.isOk).toBe(true);
    if (again.isOk) expect(again.value).toBe(first.value);
    expect(requests.size()).toBe(1); // no new row
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("re-request inside the cooldown after a cancel re-issues the decline under a fresh id: one row, cancelledAt cleared, no event", async () => {
    const first = await request({ requesterId: alice, targetId: bob });
    if (!first.isOk) throw new Error("setup");
    const row = await requests.findByPair(alice, bob);
    if (!row) throw new Error("setup");
    row.decline(NOW);
    if (row.markCancelledWhileDeclined(NOW).isErr) throw new Error("setup");
    await requests.save(row);
    events.published.length = 0; // only assert on events the re-request itself publishes

    const later = new Date(NOW.getTime() + COOLDOWN_MS - 1000); // still inside cooldown
    build(later);
    const again = await request({ requesterId: alice, targetId: bob });
    expect(again.isOk).toBe(true);
    if (!again.isOk) return;
    // A fresh id, exactly as a cancelled PENDING request gets on re-request (SEC-39): the id
    // must not reveal that the target declined.
    expect(again.value).not.toBe(first.value);
    expect(await requests.findById(first.value)).toBeNull();
    expect(requests.size()).toBe(1); // the old row is replaced, not duplicated
    const reissued = await requests.findByPair(alice, bob);
    expect(reissued?.id).toBe(again.value);
    expect(reissued?.status).toBe("declined"); // the cooldown survives
    expect(reissued?.toState().respondedAt).toEqual(NOW);
    expect(reissued?.toState().createdAt).toEqual(later);
    expect(reissued?.toState().cancelledAt).toBeUndefined(); // masked as pending again
    expect(events.names()).toEqual([]); // silent: the target hears nothing
  });

  it("cancel then re-request looks the same to the requester whether or not the target declined", async () => {
    const cancelThenReRequest = async (declineFirst: boolean) => {
      requests = new InMemoryFollowRequestRepository();
      build(NOW);
      const first = await request({ requesterId: alice, targetId: bob });
      if (!first.isOk) throw new Error("setup");
      if (declineFirst) {
        const row = await requests.findById(first.value);
        if (!row || row.decline(NOW).isErr) throw new Error("setup");
        await requests.save(row);
      }
      const cancel = makeCancelFollowRequest({
        requests,
        clock: new FixedClock(NOW),
      });
      if ((await cancel({ requestId: first.value, actorId: alice })).isErr) {
        throw new Error("setup");
      }
      const later = new Date(NOW.getTime() + 60_000);
      build(later);
      const again = await request({ requesterId: alice, targetId: bob });
      if (!again.isOk) throw new Error("re-request failed");
      const current = await requests.findByPair(alice, bob);
      if (!current) throw new Error("no row");
      return {
        freshId: again.value !== first.value,
        oldIdGone: (await requests.findById(first.value)) === null,
        rows: requests.size(),
        readsAsPending: readsAsPendingToRequester(
          {
            status: current.status,
            respondedAt: current.toState().respondedAt?.getTime(),
            cancelledAt: current.toState().cancelledAt?.getTime(),
          },
          later.getTime(),
        ),
        requestedAt: current.toState().createdAt,
      };
    };

    const pendingPath = await cancelThenReRequest(false);
    const declinedPath = await cancelThenReRequest(true);
    expect(declinedPath).toEqual(pendingPath);
    expect(pendingPath).toMatchObject({
      freshId: true,
      oldIdGone: true,
      rows: 1,
      readsAsPending: true,
    });
  });

  it("re-request after the cooldown expires on a cancelled decline creates a fresh request", async () => {
    const first = await request({ requesterId: alice, targetId: bob });
    if (!first.isOk) throw new Error("setup");
    const row = await requests.findByPair(alice, bob);
    if (!row) throw new Error("setup");
    row.decline(NOW);
    if (row.markCancelledWhileDeclined(NOW).isErr) throw new Error("setup");
    await requests.save(row);
    events.published.length = 0;

    build(new Date(NOW.getTime() + COOLDOWN_MS + 1000)); // past cooldown
    const again = await request({ requesterId: alice, targetId: bob });
    expect(again.isOk).toBe(true);
    if (again.isOk) expect(again.value).not.toBe(first.value); // fresh id
    expect(requests.size()).toBe(1); // stale cancelled row replaced
    const fresh = await requests.findByPair(alice, bob);
    expect(fresh?.status).toBe("pending");
    expect(fresh?.toState().cancelledAt).toBeUndefined();
    expect(events.names()).toEqual(["FollowRequested"]);
  });

  it("re-opens with a fresh request after the cooldown has passed", async () => {
    const first = await request({ requesterId: alice, targetId: bob });
    if (!first.isOk) throw new Error("setup");
    const row = await requests.findByPair(alice, bob);
    if (!row) throw new Error("setup");
    row.decline(NOW);
    await requests.save(row);

    build(new Date(NOW.getTime() + COOLDOWN_MS + 1000)); // past cooldown
    const again = await request({ requesterId: alice, targetId: bob });
    expect(again.isOk).toBe(true);
    if (again.isOk) expect(again.value).not.toBe(first.value);
    expect(requests.size()).toBe(1); // stale row replaced
    const fresh = await requests.findByPair(alice, bob);
    expect(fresh?.status).toBe("pending");
  });

  it("re-opens exactly at the cooldown boundary (not swallowed): boundary is < COOLDOWN_MS, not <=", async () => {
    const first = await request({ requesterId: alice, targetId: bob });
    if (!first.isOk) throw new Error("setup");
    const row = await requests.findByPair(alice, bob);
    if (!row) throw new Error("setup");
    row.decline(NOW);
    await requests.save(row);

    build(new Date(NOW.getTime() + COOLDOWN_MS)); // exactly at the boundary
    const again = await request({ requesterId: alice, targetId: bob });
    expect(again.isOk).toBe(true);
    if (again.isOk) expect(again.value).not.toBe(first.value);
    const fresh = await requests.findByPair(alice, bob);
    expect(fresh?.status).toBe("pending");
  });

  it("replaces a stale approved row immediately (cooldown applies only to declines)", async () => {
    // An approved request whose Follow edge was later removed by an unfollow: the follows
    // repo is EMPTY (otherwise the already-following rejection fires first), only the stale
    // approved row remains. Seeded directly so the event recorder stays clean.
    const seeded = FollowRequest.request({
      id: requestIds.next(),
      requesterId: alice,
      targetId: bob,
      now: NOW,
    });
    if (seeded.isErr) throw new Error("setup");
    if (seeded.value.approve(NOW).isErr) throw new Error("setup");
    await requests.save(seeded.value);

    build(new Date(NOW.getTime() + 1000)); // well within COOLDOWN_MS
    const again = await request({ requesterId: alice, targetId: bob });
    expect(again.isOk).toBe(true);
    if (again.isOk) expect(again.value).not.toBe(seeded.value.id);
    expect(requests.size()).toBe(1); // old approved row gone, fresh row in its place
    const fresh = await requests.findByPair(alice, bob);
    expect(fresh?.status).toBe("pending");
    expect(events.names()).toEqual(["FollowRequested"]);
  });

  it("pins the cooldown constant at exactly 7 days", () => {
    // Literal on the expected side so an arithmetic mutant in the formula cannot survive.
    expect(COOLDOWN_MS).toBe(604_800_000);
  });

  it("rejects a self-request", async () => {
    const result = await request({ requesterId: alice, targetId: alice });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("SelfFollow");
  });
});

describe("readsAsPendingToRequester (the silent-decline mask)", () => {
  const now = NOW.getTime();

  it("shows a pending request as pending", () => {
    expect(readsAsPendingToRequester({ status: "pending" }, now)).toBe(true);
  });

  it("shows a decline inside its cooldown as pending", () => {
    expect(
      readsAsPendingToRequester(
        { status: "declined", respondedAt: now - COOLDOWN_MS + 1 },
        now,
      ),
    ).toBe(true);
  });

  it("stops masking once the cooldown has passed (boundary included)", () => {
    expect(
      readsAsPendingToRequester(
        { status: "declined", respondedAt: now - COOLDOWN_MS },
        now,
      ),
    ).toBe(false);
  });

  it("stops masking a decline the requester cancelled", () => {
    expect(
      readsAsPendingToRequester(
        { status: "declined", respondedAt: now, cancelledAt: now },
        now,
      ),
    ).toBe(false);
  });

  it("never shows an approved request, or a decline without a response time, as pending", () => {
    expect(
      readsAsPendingToRequester({ status: "approved", respondedAt: now }, now),
    ).toBe(false);
    expect(readsAsPendingToRequester({ status: "declined" }, now)).toBe(false);
  });
});
