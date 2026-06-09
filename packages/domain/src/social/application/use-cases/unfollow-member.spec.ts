import { beforeEach, describe, expect, it } from "vitest";
import { toId } from "../../../shared-kernel";
import { MemberId } from "../../domain";
import {
  FixedClock,
  InMemoryFollowRepository,
  RecordingEventPublisher,
  SequentialFollowIdGenerator,
} from "../testing";
import { makeFollowMember } from "./follow-member";
import { makeUnfollowMember } from "./unfollow-member";

const alice = toId<"MemberId">("alice") as MemberId;
const bob = toId<"MemberId">("bob") as MemberId;
const NOW = new Date("2026-06-08T10:00:00Z");

describe("makeUnfollowMember", () => {
  let follows: InMemoryFollowRepository;
  let events: RecordingEventPublisher;
  let follow: ReturnType<typeof makeFollowMember>;
  let unfollow: ReturnType<typeof makeUnfollowMember>;

  beforeEach(() => {
    follows = new InMemoryFollowRepository();
    events = new RecordingEventPublisher();
    const clock = new FixedClock(NOW);
    follow = makeFollowMember({
      follows,
      followIds: new SequentialFollowIdGenerator(),
      events,
      clock,
    });
    unfollow = makeUnfollowMember({ follows, events, clock });
  });

  it("unfollows an existing edge: removes it and publishes MemberUnfollowed", async () => {
    expect((await follow({ followerId: alice, followeeId: bob })).isOk).toBe(true);
    expect(follows.size()).toBe(1);

    const result = await unfollow({ followerId: alice, followeeId: bob });

    expect(result.isOk).toBe(true);
    expect(follows.size()).toBe(0);
    expect(events.names()).toEqual(["MemberFollowed", "MemberUnfollowed"]);
  });

  it("rejects unfollowing when no edge exists (NotFollowing)", async () => {
    const result = await unfollow({ followerId: alice, followeeId: bob });

    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("NotFollowing");
    expect(events.published).toHaveLength(0);
  });

  it("allows re-following after an unfollow", async () => {
    expect((await follow({ followerId: alice, followeeId: bob })).isOk).toBe(true);
    expect((await unfollow({ followerId: alice, followeeId: bob })).isOk).toBe(true);

    const again = await follow({ followerId: alice, followeeId: bob });
    expect(again.isOk).toBe(true);
    expect(follows.size()).toBe(1);
  });
});
