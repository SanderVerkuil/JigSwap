import { beforeEach, describe, expect, it } from "vitest";
import { toCircleId, toMemberId } from "../../../shared-kernel";
import { CircleRoster } from "../ports/out/circle-roster";
import {
  InMemoryCircleRoster,
  InMemoryThreadRepository,
  SequentialThreadIdGenerator,
} from "../testing";
import { makeOpenCircleThread } from "./open-circle-thread";

const alice = toMemberId("alice");
const bob = toMemberId("bob");
const carol = toMemberId("carol"); // not in the circle
const circleId = toCircleId("circle-1");
const unknownCircle = toCircleId("circle-404");
const T0 = new Date("2026-06-08T09:00:00Z");
const T1 = new Date("2026-06-08T09:30:00Z");

describe("makeOpenCircleThread", () => {
  let threads: InMemoryThreadRepository;
  let roster: InMemoryCircleRoster;

  beforeEach(() => {
    threads = new InMemoryThreadRepository();
    roster = new InMemoryCircleRoster();
    roster.set(circleId, [
      { memberId: alice, joinedAt: T0 },
      { memberId: bob, joinedAt: T1 },
    ]);
  });

  const make = (circles: CircleRoster = roster) =>
    makeOpenCircleThread({
      threads,
      threadIds: new SequentialThreadIdGenerator(),
      roster: circles,
    });

  it("opens the circle's thread seeded from the roster and returns its id", async () => {
    const result = await make()({ circleId, actorId: bob });

    expect(result.isOk).toBe(true);
    if (!result.isOk) return;
    const thread = await threads.findById(result.value);
    expect(thread?.subject).toEqual({ kind: "circle", circleId });
    expect(thread?.participants).toEqual([alice, bob]);
    expect(thread?.visibleFrom(alice)).toEqual(T0);
    expect(thread?.visibleFrom(bob)).toEqual(T1);
  });

  it("is idempotent per circle", async () => {
    const open = make();

    const first = await open({ circleId, actorId: alice });
    const second = await open({ circleId, actorId: bob });

    expect(first.isOk && second.isOk).toBe(true);
    if (first.isOk && second.isOk) expect(second.value).toBe(first.value);
    expect(threads.size()).toBe(1);
  });

  it("rejects CircleNotFound for an unknown circle and writes nothing", async () => {
    const result = await make()({ circleId: unknownCircle, actorId: alice });

    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("CircleNotFound");
    expect(threads.size()).toBe(0);
  });

  it("rejects an actor outside the roster with the same CircleNotFound", async () => {
    const result = await make()({ circleId, actorId: carol });

    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("CircleNotFound");
    expect(threads.size()).toBe(0);
  });

  it("rejects CircleNotFound for an empty roster", async () => {
    roster.set(circleId, []);

    const result = await make()({ circleId, actorId: alice });

    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("CircleNotFound");
    expect(threads.size()).toBe(0);
  });

  it("refuses a non-member even when the thread already exists", async () => {
    await make()({ circleId, actorId: alice });

    const result = await make()({ circleId, actorId: carol });

    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("CircleNotFound");
  });
});
