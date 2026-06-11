import {
  Clock,
  DomainEventPublisher,
  err,
  ok,
  Result,
} from "../../../shared-kernel";
import { Follow, FollowId, SocialError } from "../../domain";
import { SocialApplicationError } from "../errors";
import {
  FollowMember,
  FollowMemberCommand,
} from "../ports/in/follow-member.port";
import { FollowRepository } from "../ports/out/follow.repository";
import { FollowIdGenerator } from "../ports/out/id-generators";

export interface FollowMemberDeps {
  readonly follows: FollowRepository;
  readonly followIds: FollowIdGenerator;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Transaction script: enforce the pair-uniqueness rule via the repository, then delegate the
// self-follow rule to Follow.establish. On success the new edge is saved and MemberFollowed is
// published. Dedupe is an application concern because it depends on stored edges, not on the
// aggregate's own data.
export const makeFollowMember =
  (deps: FollowMemberDeps): FollowMember =>
  async (
    cmd: FollowMemberCommand,
  ): Promise<Result<FollowId, SocialError | SocialApplicationError>> => {
    // One edge per (follower, followee): reject a re-follow before minting anything.
    const existing = await deps.follows.find(cmd.followerId, cmd.followeeId);
    if (existing) {
      return err(
        SocialApplicationError.alreadyFollowing(cmd.followerId, cmd.followeeId),
      );
    }

    // Entity rule: a member cannot follow themselves.
    const follow = Follow.establish({
      id: deps.followIds.next(),
      followerId: cmd.followerId,
      followeeId: cmd.followeeId,
      now: deps.clock.now(),
    });
    if (follow.isErr) return err(follow.error);

    await deps.follows.save(follow.value);
    await deps.events.publish(follow.value.pullEvents());

    return ok(follow.value.id);
  };
