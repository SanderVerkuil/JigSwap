import { beforeEach, describe, expect, it } from "vitest";
import { toMemberId } from "../../../shared-kernel";
import { MemberId } from "../../domain";
import {
  FixedClock,
  InMemoryFollowRepository,
  RecordingEventPublisher,
  SequentialFollowIdGenerator,
} from "../testing";
import { makeFollowMember } from "./follow-member";

const alice = toMemberId("alice");
const bob = toMemberId("bob");
const NOW = new Date("2026-06-08T10:00:00Z");

describe("makeFollowMember", () => {
  let follows: InMemoryFollowRepository;
  let events: RecordingEventPublisher;
  let follow: ReturnType<typeof makeFollowMember>;

  beforeEach(() => {
    follows = new InMemoryFollowRepository();
    events = new RecordingEventPublisher();
    follow = makeFollowMember({
      follows,
      followIds: new SequentialFollowIdGenerator(),
      events,
      clock: new FixedClock(NOW),
    });
  });

  it("follows a member: saves the edge and publishes MemberFollowed", async () => {
    const result = await follow({ followerId: alice, followeeId: bob });

    expect(result.isOk).toBe(true);
    expect(follows.size()).toBe(1);
    expect(events.names()).toEqual(["MemberFollowed"]);
    const published = events.published[0] as unknown as {
      followerId: MemberId;
      followeeId: MemberId;
    };
    expect(published.followerId).toBe(alice);
    expect(published.followeeId).toBe(bob);
  });

  it("rejects a self-follow and writes nothing", async () => {
    const result = await follow({ followerId: alice, followeeId: alice });

    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("SelfFollow");
    expect(follows.size()).toBe(0);
    expect(events.published).toHaveLength(0);
  });

  it("rejects a duplicate follow (pair-uniqueness) without writing a second edge", async () => {
    expect((await follow({ followerId: alice, followeeId: bob })).isOk).toBe(
      true,
    );

    const second = await follow({ followerId: alice, followeeId: bob });
    expect(second.isErr).toBe(true);
    if (second.isErr) expect(second.error.code).toBe("AlreadyFollowing");
    expect(follows.size()).toBe(1);
    expect(events.names()).toEqual(["MemberFollowed"]); // only the first
  });

  it("allows a reciprocal follow (distinct direction is a different edge)", async () => {
    expect((await follow({ followerId: alice, followeeId: bob })).isOk).toBe(
      true,
    );

    const back = await follow({ followerId: bob, followeeId: alice });
    expect(back.isOk).toBe(true);
    expect(follows.size()).toBe(2);
  });
});
