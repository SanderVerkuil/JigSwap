import { DomainEvent, err, ok, Result } from "../../shared-kernel";
import { SocialError } from "./errors";
import {
  FollowRequestApproved,
  FollowRequestDeclined,
  FollowRequested,
} from "./events";
import { FollowRequestId, MemberId } from "./ids";

export type FollowRequestStatus = "pending" | "approved" | "declined";

// Input to request(): the two parties and the instant the request is made. Pair-uniqueness
// (one open request per requester/target) needs the repository and is an application-layer
// concern; the aggregate decides only the self-request rule from its own data.
export interface RequestProps {
  readonly id: FollowRequestId;
  readonly requesterId: MemberId;
  readonly targetId: MemberId;
  readonly now: Date;
}

// The persistable shape, kept close to a `followRequests` table row so the 1b mapper is a
// trivial field-for-field translation. respondedAt is set when the target resolves it and
// backs the 7-day decline cooldown.
export interface FollowRequestState {
  readonly id: FollowRequestId;
  readonly requesterId: MemberId;
  readonly targetId: MemberId;
  readonly status: FollowRequestStatus;
  readonly createdAt: Date;
  readonly respondedAt?: Date;
  // Set when the requester cancels a still-declined (in-cooldown) request. The row is kept so the
  // decline record survives, but the read side stops masking it as pending; a re-request inside
  // the cooldown clears it again. Only ever set on a declined request.
  readonly cancelledAt?: Date;
}

// FollowRequest: a member asks to follow a private-profile member. Lifecycle is
// pending → approved | declined; only the pending state accepts a resolution. Records
// FollowRequested on creation and the matching event on each resolution.
export class FollowRequest {
  private events: DomainEvent[] = [];

  private constructor(private state: FollowRequestState) {}

  get id(): FollowRequestId {
    return this.state.id;
  }

  get requesterId(): MemberId {
    return this.state.requesterId;
  }

  get targetId(): MemberId {
    return this.state.targetId;
  }

  get status(): FollowRequestStatus {
    return this.state.status;
  }

  // Create a brand-new pending request. Rejects a self-request; pair-uniqueness is gated
  // upstream by the application layer via the repository.
  static request(props: RequestProps): Result<FollowRequest, SocialError> {
    if (props.requesterId === props.targetId) {
      return err(SocialError.selfFollow());
    }
    const request = new FollowRequest({
      id: props.id,
      requesterId: props.requesterId,
      targetId: props.targetId,
      status: "pending",
      createdAt: props.now,
    });
    request.record(
      new FollowRequested(
        props.id,
        props.requesterId,
        props.targetId,
        props.now,
      ),
    );
    return ok(request);
  }

  // Target accepts: pending → approved. The application layer establishes the Follow edge
  // in the same transaction; the aggregate only records the approval.
  approve(now: Date): Result<void, SocialError> {
    if (this.state.status !== "pending") {
      return err(SocialError.requestNotPending());
    }
    this.state = { ...this.state, status: "approved", respondedAt: now };
    this.record(
      new FollowRequestApproved(
        this.state.id,
        this.state.requesterId,
        this.state.targetId,
        now,
      ),
    );
    return ok(undefined);
  }

  // Target declines: pending → declined. Deliberately silent downstream — no notification
  // subscriber case exists for FollowRequestDeclined; respondedAt starts the re-request cooldown.
  decline(now: Date): Result<void, SocialError> {
    if (this.state.status !== "pending") {
      return err(SocialError.requestNotPending());
    }
    this.state = { ...this.state, status: "declined", respondedAt: now };
    this.record(
      new FollowRequestDeclined(
        this.state.id,
        this.state.requesterId,
        this.state.targetId,
        now,
      ),
    );
    return ok(undefined);
  }

  // Requester cancels while the request is still a declined-in-cooldown record. Retains the row
  // (the cooldown must survive a cancel) but stamps cancelledAt so the read side stops masking it
  // as pending. Records NO event — nothing subscribes to a cancel. Only valid on a declined
  // request; any other status is a caller error surfaced as RequestNotPending.
  markCancelledWhileDeclined(now: Date): Result<void, SocialError> {
    if (this.state.status !== "declined") {
      return err(SocialError.requestNotPending());
    }
    this.state = { ...this.state, cancelledAt: now };
    return ok(undefined);
  }

  // Clears the cancelled mark so a re-request inside the cooldown silently resumes the pending
  // mask. Records no event. The caller only ever invokes this on a cancelled declined request.
  reopenAfterCancel(): void {
    this.state = { ...this.state, cancelledAt: undefined };
  }

  // Drain recorded events for the publisher; clears the buffer so a save can't double-emit.
  pullEvents(): readonly DomainEvent[] {
    const drained = this.events;
    this.events = [];
    return drained;
  }

  static rehydrate(state: FollowRequestState): FollowRequest {
    return new FollowRequest(state);
  }

  toState(): FollowRequestState {
    return this.state;
  }

  private record(event: DomainEvent): void {
    this.events.push(event);
  }
}
