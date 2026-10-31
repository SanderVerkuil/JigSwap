import { beforeEach, describe, expect, it } from "vitest";
import { toCircleId, toCopyId, toMemberId } from "../../../shared-kernel";
import { CircleId } from "../../domain";
import {
  FixedClock,
  InMemoryCircleRepository,
  RecordingEventPublisher,
  SequentialCircleIdGenerator,
  SequentialMembershipIdGenerator,
} from "../testing";
import { makeAddMember } from "./add-member";
import { makeCreateCircle } from "./create-circle";
import { makeShareCopiesToCircle } from "./share-copies-to-circle";

const owner = toMemberId("owner");
const alice = toMemberId("alice");
const stranger = toMemberId("stranger");
const copies = [toCopyId("copy-1"), toCopyId("copy-2"), toCopyId("copy-3")];
const NOW = new Date("2026-10-31T10:00:00Z");

describe("makeShareCopiesToCircle", () => {
  let circles: InMemoryCircleRepository;
  let events: RecordingEventPublisher;
  let shareCopies: ReturnType<typeof makeShareCopiesToCircle>;
  let circleId: CircleId;

  beforeEach(async () => {
    circles = new InMemoryCircleRepository();
    events = new RecordingEventPublisher();
    const clock = new FixedClock(NOW);
    const membershipIds = new SequentialMembershipIdGenerator();
    const created = await makeCreateCircle({
      circles,
      circleIds: new SequentialCircleIdGenerator(),
      membershipIds,
      events,
      clock,
    })({ ownerId: owner, name: "Family" });
    if (!created.isOk) throw new Error("setup: create failed");
    circleId = created.value;
    shareCopies = makeShareCopiesToCircle({ circles, events, clock });
    const addMember = makeAddMember({ circles, membershipIds, events, clock });
    await addMember({
      circleId,
      actorId: owner,
      memberId: alice,
      permission: "ViewOnly",
    });
    events.published.length = 0;
  });

  it("shares every copy at once and publishes one CopySharedToCircle each", async () => {
    const result = await shareCopies({
      circleId,
      actorId: owner,
      copyIds: copies,
    });

    expect(result.isOk).toBe(true);
    expect(events.names()).toEqual([
      "CopySharedToCircle",
      "CopySharedToCircle",
      "CopySharedToCircle",
    ]);
  });

  it("refuses a ViewOnly member and shares none", async () => {
    const result = await shareCopies({
      circleId,
      actorId: alice,
      copyIds: copies,
    });

    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("CannotShareCopy");
    expect(events.published).toHaveLength(0);
  });

  it("tells a non-member the same CircleNotFound as an unknown circle", async () => {
    for (const cmd of [
      { circleId, actorId: stranger, copyIds: copies },
      { circleId: toCircleId("nope"), actorId: owner, copyIds: copies },
    ]) {
      const result = await shareCopies(cmd);
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("CircleNotFound");
    }
    expect(events.published).toHaveLength(0);
  });

  it("still checks the seat when there is nothing to share", async () => {
    const refused = await shareCopies({
      circleId,
      actorId: alice,
      copyIds: [],
    });
    expect(refused.isErr).toBe(true);
    if (refused.isErr) expect(refused.error.code).toBe("CannotShareCopy");

    const allowed = await shareCopies({
      circleId,
      actorId: owner,
      copyIds: [],
    });
    expect(allowed.isOk).toBe(true);
    expect(events.published).toHaveLength(0);
  });
});
