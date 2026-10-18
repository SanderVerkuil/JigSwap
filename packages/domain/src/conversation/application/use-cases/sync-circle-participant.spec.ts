import { beforeEach, describe, expect, it } from "vitest";
import {
  toCircleId,
  toExchangeId,
  toMemberId,
  toThreadId,
} from "../../../shared-kernel";
import { CircleId, MemberId, Thread } from "../../domain";
import { ThreadRepository } from "../ports/out/thread.repository";
import {
  InMemoryThreadRepository,
  RecordingEventPublisher,
  SequentialMessageIdGenerator,
} from "../testing";
import { makeSyncCircleParticipant } from "./sync-circle-participant";

const alice = toMemberId("alice");
const bob = toMemberId("bob");
const carol = toMemberId("carol");
const circleId = toCircleId("circle-1");
const otherCircle = toCircleId("circle-2");
const threadId = toThreadId("thread-1");
const T0 = new Date("2026-06-08T09:00:00Z");
const AT = new Date("2026-06-08T10:00:00Z");

describe("makeSyncCircleParticipant", () => {
  let threads: InMemoryThreadRepository;
  let events: RecordingEventPublisher;

  const make = (repo: ThreadRepository = threads) =>
    makeSyncCircleParticipant({
      threads: repo,
      messageIds: new SequentialMessageIdGenerator(),
      events,
    });

  const sync = (
    memberId: MemberId,
    change: "joined" | "left",
    circle: CircleId = circleId,
  ) => make()({ circleId: circle, memberId, change, at: AT });

  beforeEach(async () => {
    threads = new InMemoryThreadRepository();
    events = new RecordingEventPublisher();
    const opened = Thread.openForCircle(threadId, circleId, [
      { memberId: alice, joinedAt: T0 },
      { memberId: bob, joinedAt: T0 },
    ]);
    if (!opened.isOk) throw new Error("expected a circle thread");
    await threads.save(opened.value);
  });

  it("adds a joining member at `at` and posts the join system message", async () => {
    const result = await sync(carol, "joined");

    expect(result.isOk).toBe(true);
    expect(events.names()).toEqual(["ParticipantJoined", "MessagePosted"]);
    const thread = await threads.findById(threadId);
    expect(thread?.participants).toEqual([alice, bob, carol]);
    expect(thread?.visibleFrom(carol)).toEqual(AT);
    const [message] = thread?.toState().messages ?? [];
    expect(message?.kind).toBe("system");
    expect(message?.authorId).toBeNull();
    expect(message?.body).toBe("member_joined");
    expect(message?.sentAt).toEqual(AT);
    expect(message?.systemEvent).toEqual({ kind: "joined", memberId: carol });
  });

  it("removes a leaving member and posts the leave system message", async () => {
    const result = await sync(bob, "left");

    expect(result.isOk).toBe(true);
    expect(events.names()).toEqual(["ParticipantLeft", "MessagePosted"]);
    const thread = await threads.findById(threadId);
    expect(thread?.participants).toEqual([alice]);
    const [message] = thread?.toState().messages ?? [];
    expect(message?.body).toBe("member_left");
    expect(message?.systemEvent).toEqual({ kind: "left", memberId: bob });
  });

  it("does nothing when the circle has no thread yet", async () => {
    const result = await sync(carol, "joined", otherCircle);

    expect(result.isOk).toBe(true);
    expect(events.published).toHaveLength(0);
    expect(threads.size()).toBe(1);
  });

  it("writes nothing when the change is already reflected (replayed join or leave)", async () => {
    const joined = await sync(alice, "joined");
    const left = await sync(carol, "left");

    expect(joined.isOk && left.isOk).toBe(true);
    expect(events.published).toHaveLength(0);
    const thread = await threads.findById(threadId);
    expect(thread?.participants).toEqual([alice, bob]);
    expect(thread?.toState().messages).toHaveLength(0);
  });

  it("propagates ParticipantsFixed if the repository hands back a pair thread", async () => {
    const pair = Thread.openForExchange(threadId, toExchangeId("ex-1"), [
      alice,
      bob,
    ]);
    const misrouting: ThreadRepository = {
      findByExchange: async () => null,
      findById: async () => null,
      findDmByParticipants: async () => null,
      findByCircle: async () => pair,
      save: async () => {
        throw new Error("must not save");
      },
    };

    const result = await make(misrouting)({
      circleId,
      memberId: carol,
      change: "joined",
      at: AT,
    });

    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("ParticipantsFixed");
    expect(events.published).toHaveLength(0);
  });
});
