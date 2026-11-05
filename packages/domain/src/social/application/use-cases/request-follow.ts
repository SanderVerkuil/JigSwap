import {
  Clock,
  DomainEventPublisher,
  err,
  ok,
  Result,
} from "../../../shared-kernel";
import {
  FollowRequest,
  FollowRequestId,
  FollowRequestStatus,
  SocialError,
} from "../../domain";
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

// The silent-decline mask: how a request reads to the member who SENT it. A decline inside its
// cooldown that they haven't cancelled reads exactly like a pending request, so the requester
// cannot tell a decline from no answer yet. Every read that shows a requester their own request
// (the follow button's relation, notification views, quick start) uses this one rule. Times are
// epoch millis, as stored on the followRequests row.
export const readsAsPendingToRequester = (
  request: {
    readonly status: FollowRequestStatus;
    readonly respondedAt?: number;
    readonly cancelledAt?: number;
  },
  nowMs: number,
): boolean =>
  request.status === "pending" ||
  (request.status === "declined" &&
    request.cancelledAt === undefined &&
    request.respondedAt !== undefined &&
    nowMs - request.respondedAt < COOLDOWN_MS);

export interface RequestFollowDeps {
  readonly requests: FollowRequestRepository;
  readonly follows: FollowRepository;
  readonly requestIds: FollowRequestIdGenerator;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Transaction script: reject if already following; dedupe against the existing request for the
// pair (pending → idempotent; declined inside cooldown → SILENT idempotent no-op so probing
// cannot reveal a decline, or, after a cancel, the decline re-issued under a fresh id; anything
// older → replace with a fresh pending request).
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
        if (existing.isCancelled) {
          // The requester had cancelled during the cooldown, which reads to them as a removed
          // request. A cancelled pending request IS removed, and re-requesting it mints a new
          // id, so this path must too (SEC-39): re-issue the decline under a fresh id and
          // createdAt, resuming the mask. No event: the target is not told again.
          const reissued = existing.reissueAfterCancel(
            deps.requestIds.next(),
            now,
          );
          if (reissued.isErr) return err(reissued.error);
          await deps.requests.remove(existing);
          await deps.requests.save(reissued.value);
          return ok(reissued.value.id);
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
