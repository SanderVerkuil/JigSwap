import type { MemberView } from "../identity/member";
import type { ConvexSystemFields } from "../shared/convex";

/**
 * A member's public profile (display name + bio). Faithful superset of the `profiles` row plus
 * the member it belongs to. `displayName`/`bio` come from the Social aggregate; `aggregateId` is
 * the ProfileId. A member with no profile yet is represented by a null read, not this shape.
 */
export interface ProfileView extends ConvexSystemFields {
  aggregateId?: string;
  memberId: string;
  displayName: string;
  bio?: string;
  /**
   * Who can see this profile. "public" reveals the member's identity to anyone; "private" hides
   * it from members they are not connected with. Absent on legacy rows, derived as "public".
   */
  visibility: "public" | "private";
  updatedAt: number;
}

/**
 * One party of a follow relationship as surfaced in a followers/following list: the other member's
 * id, their display name (from their profile, falling back to their account name), and when the
 * edge formed. `followId` is the Follow aggregateId so the UI can act on the specific edge.
 */
export interface FollowEdgeView {
  followId?: string;
  memberId: string;
  displayName: string;
  createdAt: number;
}

/**
 * One entry in a member's activity feed, mapped at the backend seam from foreign domain events
 * (CompletionRecorded / CopyAcquired / ExchangeCompleted) into Social's anti-corruption shape.
 * `ref` is an opaque pointer back to the originating record for the UI to deep-link.
 */
export interface ActivityEntryView {
  memberId: string;
  kind: "completion" | "acquisition" | "exchange";
  occurredAt: number;
  ref: string;
}

/**
 * One community comment on a puzzle, as surfaced on the catalog/copy view. A comment is posted
 * against the puzzle DEFINITION, so every owned copy of that puzzle shows the same list. The
 * `author` is the real member identity (comments are voluntary public posts — never anonymised);
 * `rating` is the author's optional 1–5 star opinion, or null when they left only text. `id` is the
 * CommentId aggregateId. Newest comments are returned first.
 */
export interface PuzzleCommentView {
  id: string;
  author: MemberView;
  text: string;
  rating: number | null;
  createdAt: number;
}

/**
 * One discussion comment on a single shared PHOTO (an `ownedPuzzleImages` row), as surfaced in the
 * photo lightbox. Unlike a PuzzleCommentView there is no rating — photo comments are plain text. The
 * `author` is the real member identity (these are voluntary public posts — never anonymised); `id`
 * is the PhotoCommentId aggregateId. Newest comments are returned first.
 */
export interface PhotoCommentView {
  id: string;
  author: MemberView;
  text: string;
  createdAt: number;
}

/**
 * The server-side projection of one member's identity to a given viewer, the output of the privacy
 * chokepoint that gates every participant surfaced in a copy's history. A discriminated union: when
 * `anonymous` is false the member is revealed as a full MemberView; when true the member is hidden
 * and ONLY a deterministic, non-reversible `anonRef` is emitted — NO real id, name, username, or
 * avatar crosses the wire. The viewer is revealed a member iff it is themself, the member's profile
 * is public, or the two are mutual followers; otherwise the member is anonymised. The "Anonymous
 * user" label is the UI's concern (i18n there); it is intentionally NOT part of this DTO.
 */
export type ProjectedMember =
  | { anonymous: false; member: MemberView }
  | { anonymous: true; anonRef: string };

/**
 * The unauthenticated "who is this member" read behind /members/$handle. Deliberately tiny:
 * identity fields only — never bio, shelf, stats, or location. A private member IS named here:
 * reachable by direct link (the spec's Instagram-style interstitial) but not enumerable (search
 * stays visibility-gated) and not indexable (the page renders a robots noindex for private
 * profiles). `avatar` is consent-gated for anonymous callers (users.shareAvatarPublicly);
 * `puzzleCount` is only disclosed for public profiles.
 */
export interface PublicMemberTeaserView {
  memberId: string;
  displayName: string;
  username?: string;
  /** The member's Convex-owned profile handle (identity/setSlug), if they've chosen one. */
  slug?: string;
  avatar?: string;
  /** users.createdAt (ms). */
  memberSince: number;
  visibility: "public" | "private";
  /** Owned-copy count; null for private profiles. */
  puzzleCount: number | null;
}

/**
 * The identity card shown on the public member profile, disclosed regardless of lock state (an
 * Instagram-style private-account header: name, avatar, follow counts, and rating are always
 * visible; only the deeper `story`/`stats`/`records` are gated). `avatar` is consent-gated for
 * anonymous callers exactly like PublicMemberTeaserView (users.shareAvatarPublicly). `location` is
 * the strict exception: it is included ONLY when `visibility === "public"`, in BOTH the locked and
 * unlocked payload — a private profile never discloses location to a non-owner, even a mutual
 * follower, and the rule does not special-case the owner viewing their own profile either.
 */
export interface PublicProfileHero {
  memberId: string;
  displayName: string;
  username?: string;
  slug?: string;
  avatar?: string;
  /** users.createdAt (ms). */
  memberSince: number;
  rating: number;
  reviewCount: number;
  followerCount: number;
  followingCount: number;
  visibility: "public" | "private";
  /** Only present when visibility === "public" — see class doc. */
  location?: string;
}

/** Coarse collection/activity aggregates, UNLOCKED only. */
export interface PublicProfileStats {
  puzzlesOwned: number;
  completions: number;
  piecesPlaced: number;
  swaps: number;
}

/** Standout completions, UNLOCKED only. Either entry is null when the member has no completions
 * carrying the relevant field (no timed completion for `fastest`, no sized completion for
 * `hardest`). */
export interface PublicProfileRecords {
  fastest: { title: string; minutes: number } | null;
  hardest: { title: string; pieceCount: number } | null;
}

/**
 * The visibility-gated read behind the redesigned public member profile page. A discriminated
 * union on `locked`: UNLOCKED (visibility public, viewer is the owner, or viewer is a mutual
 * follower) carries the full `story`/`stats`/`records`; LOCKED (private + non-mutual viewer,
 * including logged-out) carries only `hero` — never story, stats, or records. This is the public,
 * unauthenticated-capable surface: the payload must never leak another member's raw id, name,
 * copy ids/conditions/prices, clerkIds, emails, or (per PublicProfileHero) location for a private
 * profile.
 */
export type PublicProfileView =
  | {
      locked: false;
      hero: PublicProfileHero;
      /** profiles.bio; omitted when the member has none. UNLOCKED only. */
      story?: string;
      stats: PublicProfileStats;
      records: PublicProfileRecords;
    }
  | { locked: true; hero: PublicProfileHero };
