import { err, ok, Result } from "../../../shared-kernel";
import { SocialApplicationError } from "../errors";
import {
  CancelFollowRequest,
  CancelFollowRequestCommand,
} from "../ports/in/cancel-follow-request.port";
import { FollowRequestRepository } from "../ports/out/follow-request.repository";

export interface CancelFollowRequestDeps {
  readonly requests: FollowRequestRepository;
}

// Withdrawing a pending request removes the row outright: nothing subscribes to a
// cancellation, and a removed row lets the requester re-request immediately.
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
    await deps.requests.remove(request);
    return ok(undefined);
  };
