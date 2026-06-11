import { Result } from "../../../../shared-kernel";
import { FollowId, MemberId, SocialError } from "../../../domain";
import { SocialApplicationError } from "../../errors";

// The command to follow a member. `followerId` is resolved from auth by the transport adapter.
export interface FollowMemberCommand {
  readonly followerId: MemberId;
  readonly followeeId: MemberId;
}

// Inbound port: the follow-member use case. Yields the new edge's id on success.
export interface FollowMember {
  (
    cmd: FollowMemberCommand,
  ): Promise<Result<FollowId, SocialError | SocialApplicationError>>;
}
