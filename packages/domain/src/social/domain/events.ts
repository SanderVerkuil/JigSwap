import { DomainEvent } from "../../shared-kernel";
import {
  CommentId,
  MemberId,
  PhotoCommentId,
  PhotoId,
  ProfileId,
  PuzzleDefinitionId,
} from "./ids";
import { ProfileVisibility } from "./profile";

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

// A member changed who can see their profile (public <-> private). Other features read the new
// visibility to decide whether to reveal the member's identity.
export class ProfileVisibilityChanged implements DomainEvent {
  readonly name = "ProfileVisibilityChanged";
  constructor(
    readonly profileId: ProfileId,
    readonly memberId: MemberId,
    readonly visibility: ProfileVisibility,
    readonly occurredAt: Date,
  ) {}
}

// A member posted a community comment on a puzzle definition. The rating is null when the author
// left only text. Carries the PuzzleDefinitionId so subscribers (future Insights/Notifications) can
// react without resolving the comment back through persistence.
export class CommentPosted implements DomainEvent {
  readonly name = "CommentPosted";
  constructor(
    readonly commentId: CommentId,
    readonly puzzleId: PuzzleDefinitionId,
    readonly authorId: MemberId,
    readonly text: string,
    readonly rating: number | null,
    readonly occurredAt: Date,
  ) {}
}

// A member posted a discussion comment on a single shared PHOTO. Photo comments are text-only (no
// rating). Carries the PhotoId so subscribers (future Notifications) can react without resolving the
// comment back through persistence.
export class PhotoCommentPosted implements DomainEvent {
  readonly name = "PhotoCommentPosted";
  constructor(
    readonly commentId: PhotoCommentId,
    readonly photoId: PhotoId,
    readonly authorId: MemberId,
    readonly text: string,
    readonly occurredAt: Date,
  ) {}
}

// A member re-arranged their profile display shelf (the ordered, curated set of owned copies
// shown on their profile). copyIds is the new ordered list (deduped, capped); empty clears it.
export class ProfileShelfArranged implements DomainEvent {
  readonly name = "ProfileShelfArranged";
  constructor(
    readonly profileId: ProfileId,
    readonly memberId: MemberId,
    readonly copyIds: readonly string[],
    readonly occurredAt: Date,
  ) {}
}

export type SocialDomainEvent =
  | MemberFollowed
  | MemberUnfollowed
  | ProfileUpdated
  | ProfileVisibilityChanged
  | CommentPosted
  | PhotoCommentPosted
  | ProfileShelfArranged;
