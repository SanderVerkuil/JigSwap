import { describe, expect, it } from "vitest";
import { toId } from "../../shared-kernel";
import { Follow } from "./follow";
import { FollowId, MemberId } from "./ids";

const follower = toId<"MemberId">("alice") as MemberId;
const followee = toId<"MemberId">("bob") as MemberId;
const followId = toId<"FollowId">("follow-1") as FollowId;
const NOW = new Date("2026-06-08T10:00:00Z");

describe("Follow.establish", () => {
  it("creates an edge and records MemberFollowed with the two parties", () => {
    const result = Follow.establish({
      id: followId,
      followerId: follower,
      followeeId: followee,
      now: NOW,
    });
    expect(result.isOk).toBe(true);
    if (!result.isOk) return;

    const follow = result.value;
    expect(follow.followerId).toBe(follower);
    expect(follow.followeeId).toBe(followee);

    const events = follow.pullEvents();
    expect(events.map((e) => e.name)).toEqual(["MemberFollowed"]);
    const followed = events[0] as unknown as {
      followerId: MemberId;
      followeeId: MemberId;
      occurredAt: Date;
    };
    expect(followed.followerId).toBe(follower);
    expect(followed.followeeId).toBe(followee);
    expect(followed.occurredAt).toBe(NOW);
  });

  it("drains events only once", () => {
    const result = Follow.establish({
      id: followId,
      followerId: follower,
      followeeId: followee,
      now: NOW,
    });
    if (!result.isOk) throw new Error("setup");
    expect(result.value.pullEvents()).toHaveLength(1);
    expect(result.value.pullEvents()).toHaveLength(0);
  });

  it("rejects a self-follow (follower === followee)", () => {
    const result = Follow.establish({
      id: followId,
      followerId: follower,
      followeeId: follower,
      now: NOW,
    });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("SelfFollow");
  });

  it("records MemberUnfollowed when severed", () => {
    const result = Follow.establish({
      id: followId,
      followerId: follower,
      followeeId: followee,
      now: NOW,
    });
    if (!result.isOk) throw new Error("setup");
    result.value.pullEvents(); // discard MemberFollowed

    const later = new Date("2026-06-09T10:00:00Z");
    result.value.unfollow(later);
    const events = result.value.pullEvents();
    expect(events.map((e) => e.name)).toEqual(["MemberUnfollowed"]);
    const unfollowed = events[0] as unknown as {
      followerId: MemberId;
      followeeId: MemberId;
      occurredAt: Date;
    };
    expect(unfollowed.followerId).toBe(follower);
    expect(unfollowed.followeeId).toBe(followee);
    expect(unfollowed.occurredAt).toBe(later);
  });

  it("round-trips through toState/rehydrate without re-emitting creation events", () => {
    const result = Follow.establish({
      id: followId,
      followerId: follower,
      followeeId: followee,
      now: NOW,
    });
    if (!result.isOk) throw new Error("setup");
    const rehydrated = Follow.rehydrate(result.value.toState());
    expect(rehydrated.id).toBe(followId);
    expect(rehydrated.followerId).toBe(follower);
    expect(rehydrated.pullEvents()).toHaveLength(0);
  });
});
