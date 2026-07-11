import { Result } from "../../../../shared-kernel";
import { FollowRequestId, MemberId, SocialError } from "../../../domain";
import { SocialApplicationError } from "../../errors";

export interface ApproveFollowRequestCommand {
  readonly requestId: FollowRequestId;
  readonly actorId: MemberId; // must be the request's target
}

// What the UI needs to offer "follow back" in one tap after approving.
export interface ApproveFollowRequestResult {
  readonly requesterId: MemberId;
  readonly alreadyFollowsBack: boolean;
}

export interface ApproveFollowRequest {
  (
    cmd: ApproveFollowRequestCommand,
  ): Promise<
    Result<ApproveFollowRequestResult, SocialError | SocialApplicationError>
  >;
}
