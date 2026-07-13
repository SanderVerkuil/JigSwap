import { Clock, err, ok, Result } from "../../../shared-kernel";
import { SocialApplicationError } from "../errors";
import {
  CancelFollowRequest,
  CancelFollowRequestCommand,
} from "../ports/in/cancel-follow-request.port";
import { FollowRequestRepository } from "../ports/out/follow-request.repository";

export interface CancelFollowRequestDeps {
  readonly requests: FollowRequestRepository;
  readonly clock: Clock;
}

// Withdrawing a request. A still-pending (or stale approved) request is removed outright:
// nothing subscribes to a cancellation and a removed row lets the requester re-request
// immediately. A DECLINED-in-cooldown request must NOT be destroyed — that would defeat the
// silent-decline cooldown — so instead it is stamped cancelledAt (row retained): the read side
// stops masking it as pending, and a re-request inside the cooldown silently resumes the mask.
// The aggregate's status guard decides which path applies.
export const makeCancelFollowRequest =
  (deps: CancelFollowRequestDeps): CancelFollowRequest =>
  async (
    cmd: CancelFollowRequestCommand,
  ): Promise<Result<void, SocialApplicationError>> => {
    const request = await deps.requests.findById(cmd.requestId);
    if (!request) return err(SocialApplicationError.requestNotFound());
    if (request.requesterId !== cmd.actorId) {
      return err(SocialApplicationError.notRequestOwner());
    }
    const marked = request.markCancelledWhileDeclined(deps.clock.now());
    if (marked.isOk) {
      // Declined-in-cooldown: retain the row with the cancelled mark set.
      await deps.requests.save(request);
    } else {
      // Pending or stale approved: no cooldown record to preserve, so remove outright.
      await deps.requests.remove(request);
    }
    return ok(undefined);
  };
