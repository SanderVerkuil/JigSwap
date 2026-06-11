import { DomainEvent } from "../../shared-kernel";
import { MemberId, ProfileId } from "./ids";

// All Social domain events implement DomainEvent (name + occurredAt). They are plain immutable
// records: the aggregate records them; an outbound publisher (1b) serialises and dispatches them
// to subscribers (Notifications, Insights, and follower activity feeds).

// One member started following another.
export class MemberFollowed implements DomainEvent {
  readonly name = "MemberFollowed";
  constructor(
    readonly followerId: MemberId,
    readonly followeeId: MemberId,
    readonly occurredAt: Date,
  ) {}
}

// A previously established follow relationship was severed.
export class MemberUnfollowed implements DomainEvent {
  readonly name = "MemberUnfollowed";
  constructor(
    readonly followerId: MemberId,
    readonly followeeId: MemberId,
    readonly occurredAt: Date,
  ) {}
}

// A member edited the editable fields of their profile (display name and/or bio).
export class ProfileUpdated implements DomainEvent {
  readonly name = "ProfileUpdated";
  constructor(
    readonly profileId: ProfileId,
    readonly memberId: MemberId,
    readonly displayName: string,
    readonly occurredAt: Date,
  ) {}
}

export type SocialDomainEvent =
  | MemberFollowed
  | MemberUnfollowed
  | ProfileUpdated;
