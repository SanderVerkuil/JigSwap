import { Result } from "../../../../shared-kernel";
import { FollowRequestId, MemberId, SocialError } from "../../../domain";
import { SocialApplicationError } from "../../errors";

// The command to request to follow a private-profile member. `requesterId` is resolved from
// auth by the transport adapter; the visibility decision (instant follow vs request) is made
// at the composition root before this port is invoked.
export interface RequestFollowCommand {
  readonly requesterId: MemberId;
  readonly targetId: MemberId;
}

// Inbound port: yields the (new or still-pending) request's id. Idempotent for an open
// request and silently idempotent during a decline cooldown, so a declined request is
// indistinguishable from an unanswered one.
export interface RequestFollow {
  (
    cmd: RequestFollowCommand,
  ): Promise<Result<FollowRequestId, SocialError | SocialApplicationError>>;
}
