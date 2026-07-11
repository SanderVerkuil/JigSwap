import {
  Clock,
  DomainEventPublisher,
  err,
  ok,
  Result,
} from "../../../shared-kernel";
import { SocialError } from "../../domain";
import { SocialApplicationError } from "../errors";
import {
  DeclineFollowRequest,
  DeclineFollowRequestCommand,
} from "../ports/in/decline-follow-request.port";
import { FollowRequestRepository } from "../ports/out/follow-request.repository";

export interface DeclineFollowRequestDeps {
  readonly requests: FollowRequestRepository;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Decline is silent downstream: the event is recorded for the durable log, but the
// Notifications subscriber deliberately has no case for it and the read side keeps
// presenting the request as pending until the cooldown lapses.
export const makeDeclineFollowRequest =
  (deps: DeclineFollowRequestDeps): DeclineFollowRequest =>
  async (
    cmd: DeclineFollowRequestCommand,
  ): Promise<Result<void, SocialError | SocialApplicationError>> => {
    const request = await deps.requests.findById(cmd.requestId);
    if (!request) return err(SocialApplicationError.requestNotFound());
    if (request.targetId !== cmd.actorId) {
      return err(SocialApplicationError.notRequestTarget());
    }

    const declined = request.decline(deps.clock.now());
    if (declined.isErr) return err(declined.error);

    await deps.requests.save(request);
    await deps.events.publish(request.pullEvents());
    return ok(undefined);
  };
