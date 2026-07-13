import {
  Clock,
  DomainEvent,
  DomainEventPublisher,
  err,
  ok,
  Result,
} from "../../../shared-kernel";
import { Follow, SocialError } from "../../domain";
import { SocialApplicationError } from "../errors";
import {
  ApproveFollowRequest,
  ApproveFollowRequestCommand,
  ApproveFollowRequestResult,
} from "../ports/in/approve-follow-request.port";
import { FollowRequestRepository } from "../ports/out/follow-request.repository";
import { FollowRepository } from "../ports/out/follow.repository";
import { FollowIdGenerator } from "../ports/out/id-generators";

export interface ApproveFollowRequestDeps {
  readonly requests: FollowRequestRepository;
  readonly follows: FollowRepository;
  readonly followIds: FollowIdGenerator;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Orchestrates BOTH aggregates in one transaction: approve the request, then establish the
// requester→target Follow edge (tolerating an already-existing edge), then publish both event
// batches. The actor ACL (only the target resolves) is checked here — it needs the loaded
// aggregate, not just auth.
export const makeApproveFollowRequest =
  (deps: ApproveFollowRequestDeps): ApproveFollowRequest =>
  async (
    cmd: ApproveFollowRequestCommand,
  ): Promise<
    Result<ApproveFollowRequestResult, SocialError | SocialApplicationError>
  > => {
    const request = await deps.requests.findById(cmd.requestId);
    if (!request) return err(SocialApplicationError.requestNotFound());
    if (request.targetId !== cmd.actorId) {
      return err(SocialApplicationError.notRequestTarget());
    }

    const now = deps.clock.now();
    const approved = request.approve(now);
    if (approved.isErr) return err(approved.error);

    // Establish the edge unless a stray one already exists (duplicate-tolerant).
    const existingEdge = await deps.follows.find(
      request.requesterId,
      request.targetId,
    );
    let edgeEvents: readonly DomainEvent[] = [];
    if (!existingEdge) {
      const edge = Follow.establish({
        id: deps.followIds.next(),
        followerId: request.requesterId,
        followeeId: request.targetId,
        now,
      });
      if (edge.isErr) return err(edge.error);
      await deps.follows.save(edge.value);
      edgeEvents = edge.value.pullEvents();
    }

    await deps.requests.save(request);
    await deps.events.publish([...request.pullEvents(), ...edgeEvents]);

    const alreadyFollowsBack =
      (await deps.follows.find(request.targetId, request.requesterId)) !== null;
    return ok({ requesterId: request.requesterId, alreadyFollowsBack });
  };
