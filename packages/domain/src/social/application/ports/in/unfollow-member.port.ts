import { Result } from "../../../../shared-kernel";
import { MemberId } from "../../../domain";
import { SocialApplicationError } from "../../errors";

// The command to unfollow a member. `followerId` is resolved from auth by the transport adapter.
export interface UnfollowMemberCommand {
  readonly followerId: MemberId;
  readonly followeeId: MemberId;
}

// Inbound port: the unfollow-member use case. Fails with NotFollowing when no edge exists.
export interface UnfollowMember {
  (cmd: UnfollowMemberCommand): Promise<Result<void, SocialApplicationError>>;
}
