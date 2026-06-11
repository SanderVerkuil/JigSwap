import { DomainEvent, err, ok, Result } from "../../shared-kernel";
import { SocialError } from "./errors";
import { MemberFollowed, MemberUnfollowed } from "./events";
import { FollowId, MemberId } from "./ids";

// Input to establish(): the two parties of the relationship and the instant it forms. The
// pair-uniqueness rule (one Follow per follower/followee) needs the repository and is an
// application-layer concern; the aggregate decides only the self-follow rule from its own data.
export interface EstablishProps {
  readonly id: FollowId;
  readonly followerId: MemberId;
  readonly followeeId: MemberId;
  readonly now: Date;
}

// The persistable shape of a follow edge, kept close to a `follows` table so the 1b mapper is a
// trivial field-for-field translation.
export interface FollowState {
  readonly id: FollowId;
  readonly followerId: MemberId;
  readonly followeeId: MemberId;
  readonly createdAt: Date;
}

// Follow: a directed relationship aggregate (followerId -> followeeId). Created via establish,
// which enforces the only invariant decidable from its own data — a member cannot follow
// themselves. Records MemberFollowed on creation and MemberUnfollowed when severed.
export class Follow {
  private events: DomainEvent[] = [];

  private constructor(private readonly state: FollowState) {}

  get id(): FollowId {
    return this.state.id;
  }

  get followerId(): MemberId {
    return this.state.followerId;
  }

  get followeeId(): MemberId {
    return this.state.followeeId;
  }

  // Create a brand-new follow edge. Rejects a self-follow; pair-uniqueness is gated upstream by
  // the application layer via the repository. Records MemberFollowed on success.
  static establish(props: EstablishProps): Result<Follow, SocialError> {
    if (props.followerId === props.followeeId) {
      return err(SocialError.selfFollow());
    }

    const follow = new Follow({
      id: props.id,
      followerId: props.followerId,
      followeeId: props.followeeId,
      createdAt: props.now,
    });
    follow.record(
      new MemberFollowed(props.followerId, props.followeeId, props.now),
    );
    return ok(follow);
  }

  // Record the severing of this relationship. The application layer deletes the edge from the
  // repository; the aggregate only emits MemberUnfollowed so feeds and Notifications can react.
  unfollow(now: Date): void {
    this.record(
      new MemberUnfollowed(this.state.followerId, this.state.followeeId, now),
    );
  }

  // Drain recorded events for the publisher; clears the buffer so a save can't double-emit.
  pullEvents(): readonly DomainEvent[] {
    const drained = this.events;
    this.events = [];
    return drained;
  }

  // Map to/from persistence without the aggregate knowing about any storage technology.
  static rehydrate(state: FollowState): Follow {
    return new Follow(state);
  }

  toState(): FollowState {
    return this.state;
  }

  private record(event: DomainEvent): void {
    this.events.push(event);
  }
}
