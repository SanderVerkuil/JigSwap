import {
  Clock,
  DomainEventPublisher,
  err,
  ok,
  Result,
} from "../../../shared-kernel";
import { FollowRequest, FollowRequestId, SocialError } from "../../domain";
import { SocialApplicationError } from "../errors";
import {
  RequestFollow,
  RequestFollowCommand,
} from "../ports/in/request-follow.port";
import { FollowRequestRepository } from "../ports/out/follow-request.repository";
import { FollowRepository } from "../ports/out/follow.repository";
import { FollowRequestIdGenerator } from "../ports/out/id-generators";

// How long after a (silent) decline the requester's next attempt is swallowed. Chosen in the
// spec: 7 days. Exported so the read side presents "declined but cooling down" as pending.
export const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

export interface RequestFollowDeps {
  readonly requests: FollowRequestRepository;
  readonly follows: FollowRepository;
  readonly requestIds: FollowRequestIdGenerator;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Transaction script: reject if already following; dedupe against the existing request for the
// pair (pending → idempotent; declined inside cooldown → SILENT idempotent no-op so probing
// cannot reveal a decline; anything older → replace with a fresh pending request).
export const makeRequestFollow =
  (deps: RequestFollowDeps): RequestFollow =>
  async (
    cmd: RequestFollowCommand,
  ): Promise<Result<FollowRequestId, SocialError | SocialApplicationError>> => {
    const edge = await deps.follows.find(cmd.requesterId, cmd.targetId);
    if (edge) {
      return err(
        SocialApplicationError.alreadyFollowing(cmd.requesterId, cmd.targetId),
      );
    }

    const now = deps.clock.now();
    const existing = await deps.requests.findByPair(
      cmd.requesterId,
      cmd.targetId,
    );
    if (existing) {
      const state = existing.toState();
      if (state.status === "pending") return ok(existing.id);
      if (
        state.status === "declined" &&
        state.respondedAt &&
        now.getTime() - state.respondedAt.getTime() < COOLDOWN_MS
      ) {
        // Silent decline: inside the cooldown a re-request is swallowed and the old id
        // returned, exactly as if the target simply hadn't answered yet.
        if (state.cancelledAt !== undefined) {
          // The requester had cancelled during the cooldown (which un-masked the row on the
          // read side). Re-requesting resumes the mask: clear the cancel, no event, same id.
          existing.reopenAfterCancel();
          await deps.requests.save(existing);
        }
        return ok(existing.id);
      }
      // Cooldown passed, or a stale approved row whose edge was later unfollowed: replace.
      await deps.requests.remove(existing);
    }

    const request = FollowRequest.request({
      id: deps.requestIds.next(),
      requesterId: cmd.requesterId,
      targetId: cmd.targetId,
      now,
    });
    if (request.isErr) return err(request.error);

    await deps.requests.save(request.value);
    await deps.events.publish(request.value.pullEvents());
    return ok(request.value.id);
  };
