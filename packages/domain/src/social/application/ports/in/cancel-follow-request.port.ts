import { Result } from "../../../../shared-kernel";
import { FollowRequestId, MemberId } from "../../../domain";
import { SocialApplicationError } from "../../errors";

export interface CancelFollowRequestCommand {
  readonly requestId: FollowRequestId;
  readonly actorId: MemberId; // must be the request's requester
}

export interface CancelFollowRequest {
  (
    cmd: CancelFollowRequestCommand,
  ): Promise<Result<void, SocialApplicationError>>;
}
