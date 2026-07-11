import { Result } from "../../../../shared-kernel";
import { FollowRequestId, MemberId, SocialError } from "../../../domain";
import { SocialApplicationError } from "../../errors";

export interface DeclineFollowRequestCommand {
  readonly requestId: FollowRequestId;
  readonly actorId: MemberId; // must be the request's target
}

export interface DeclineFollowRequest {
  (
    cmd: DeclineFollowRequestCommand,
  ): Promise<Result<void, SocialError | SocialApplicationError>>;
}
