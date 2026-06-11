import {
  Clock,
  DomainEventPublisher,
  err,
  ok,
  Result,
} from "../../../shared-kernel";
import { SocialApplicationError } from "../errors";
import {
  UnfollowMember,
  UnfollowMemberCommand,
} from "../ports/in/unfollow-member.port";
import { FollowRepository } from "../ports/out/follow.repository";

export interface UnfollowMemberDeps {
  readonly follows: FollowRepository;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Transaction script: look up the existing edge (NotFollowing if absent), record the severing on
// the aggregate so it emits MemberUnfollowed, remove it from the repository, then publish.
export const makeUnfollowMember =
  (deps: UnfollowMemberDeps): UnfollowMember =>
  async (
    cmd: UnfollowMemberCommand,
  ): Promise<Result<void, SocialApplicationError>> => {
    const follow = await deps.follows.find(cmd.followerId, cmd.followeeId);
    if (!follow) {
      return err(
        SocialApplicationError.notFollowing(cmd.followerId, cmd.followeeId),
      );
    }

    follow.unfollow(deps.clock.now());
    await deps.follows.remove(follow);
    await deps.events.publish(follow.pullEvents());

    return ok(undefined);
  };
