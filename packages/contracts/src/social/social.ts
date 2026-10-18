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
  /** Member-chosen profile name; absent until the member sets one. */
  displayName?: string;
  bio?: string;
  /**
   * Who can see this profile. "public" reveals the member's identity to anyone; "private" hides
   * it from members they are not connected with. Absent on legacy rows, derived as "public".
   */
  visibility: "public" | "private";
  updatedAt: number;
  /**
   * Set when the viewer blocked this member: a stub (no bio) so the UI can offer Unblock. A
   * member who blocked the viewer reads as null instead.
   */
  blockedByMe?: true;
}

/**
 * One party of a follow relationship as surfaced in a followers/following list: the other member's
 * id, their display name (from their profile, falling back to their account name), and when the
 * edge formed. `followId` is the Follow aggregateId so the UI can act on the specific edge.
 */
export interface FollowEdgeView {
  followId?: string;
  memberId: string;
  /** Resolved server-side (profile displayName → account name → username, never email); absent = render the generic member label. */
  displayName?: string;
  createdAt: number;
}

/**
 * One entry in a member's activity feed, mapped at the backend seam from foreign domain events
 * (CompletionRecorded / CopyAcquired / ExchangeCompleted) into Social's anti-corruption shape.
 * `ref` is an opaque pointer back to the originating record for the UI to deep-link. `actorName` is
 * the actor's display name (their Social profile displayName, falling back to their account name) —
 * resolved server-side so the UI can render "You"/"{name}" without an extra per-row lookup; the
 * feed's audience is always self + followees, so every actor here is already visible to the viewer.
 */
export interface ActivityEntryView {
  memberId: string;
  kind:
    "completion" | "acquisition" | "acquisitionBatch" | "exchange" | "started";
  occurredAt: number;
  ref: string;
  /** Resolved server-side (profile displayName → account name → username, never email); absent = render the generic member label. */
  actorName?: string;
  /** Present only on "acquisitionBatch" entries (`ref` is then the batch id). */
  batch?: ActivityBatchView;
  /**
   * The actor's profile link, present only when their profile page resolves (an active member).
   * `handle` is the member id: profile handles resolve id-first, and the page redirects to the
   * canonical slug/username.
   */
  actor?: { handle: string };
  /** Where the entry links. Absent = the entry renders as plain text. */
  target?: ActivityTargetView;
}

/**
 * Where an activity entry navigates, decided server-side and emitted ONLY after the same gate the
 * target page's own read applies (ids are doc _ids, as the routes parse them):
 *   - "myCopy" / "copy": the copy page (canViewCopy); "myCopy" when the viewer owns it.
 *   - "definition": the puzzle definition page (any member).
 *   - "memberPuzzles": the actor's profile puzzles (the profile unlock rule).
 *   - "trades": the viewer's own trades page (only when the viewer is a party to the exchange).
 */
export type ActivityTargetView =
  | { kind: "myCopy" | "copy" | "definition"; id: string }
  | { kind: "memberPuzzles"; handle: string }
  | { kind: "trades" };

/**
 * One batch add (a single quick-start acquireCopies call) folded into one feed entry. `count` and
 * `covers` cover only the copies THIS viewer may see (canViewCopy + the profile unlock rule), so a
 * batch never reveals hidden copies; a batch with no visible copy is not in the feed at all.
 */
export interface ActivityBatchView {
  count: number;
  /** The first few visible copies in pick order (at most 4). */
  covers: ActivityBatchCoverView[];
}

export interface ActivityBatchCoverView {
  /** The copy's Library aggregateId. */
  copyId: string;
  title: string;
  /** Approved cover photo, else the puzzle's box art; null = render the placeholder. */
  coverUrl: string | null;
}

/**
 * One PLAIN-TEXT comment on an owned copy, as surfaced on the copy view. Comments carry no rating —
 * copy-level star opinions live in `copyReviews`, and definition-level opinions are
 * PuzzleReviewView. The `author` is the real member identity (comments are voluntary public posts —
 * never anonymised); `id` is the CommentId aggregateId. Newest comments are returned first.
 */
export interface PuzzleCommentView {
  id: string;
  author: MemberView;
  text: string;
  createdAt: number;
}

/**
 * One community review of a puzzle DEFINITION, as surfaced on the catalog detail page. A review is
 * the author's single upserted opinion: `rating` is their 1–5 star score (null when they left only
 * text) and `text` their optional write-up (null when they left only stars). The `author` is the
 * real member identity (reviews are voluntary public posts — never anonymised); `updatedAt` is when
 * the review was last written. Newest reviews are returned first.
 */
export interface PuzzleReviewView {
  id: string;
  author: MemberView;
  rating: number | null;
  text: string | null;
  updatedAt: number;
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
  | {
      anonymous: true;
      anonRef: string;
      /**
       * Set when the member's account is gone (deleted or deactivated), so the UI can say "Former
       * member" rather than the anonymous label. Carries no identity. Today only exchange-thread
       * inbox subjects (the per-trade projection) set it.
       */
      departed?: true;
    };

/**
 * An open connection offer to the viewer (social.listMyConnectionOffers): the person who invited
 * them to JigSwap offers to follow each other, and nothing is followed until the viewer accepts.
 * `offerId` is what acceptConnection / declineConnection take.
 */
export interface ConnectionOfferView {
  readonly offerId: string;
  /** Teaser-shaped: exactly what the invite landing (/members/$handle) already disclosed. */
  readonly from: MemberTeaserIdentity;
  readonly source: "inviteLink" | "householdLink";
  readonly createdAt: number;
}

/**
 * "Followers you know" social proof for a member profile: accounts the VIEWER follows who also
 * follow the target member (viewer's following ∩ target's followers) — deliberately NOT plain
 * mutual followers. Personalized (the read is requireMember-gated) and one direction only.
 * `total` is the full intersection size; `members` is a short preview (capped, currently 8) with
 * just enough identity to render an avatar stack + name and link to /members/$handle
 * (slug ?? username ?? memberId).
 */
export interface FollowersYouKnowView {
  total: number;
  members: {
    memberId: string;
    /** Resolved server-side (profile displayName → account name → username, never email); absent = render the generic member label. */
    displayName?: string;
    avatar?: string;
    username?: string;
    slug?: string;
  }[];
}

/**
 * The identity part of {@link PublicMemberTeaserView}: name, handle and avatar, never bio,
 * location, stats or counts. Reused wherever a surface may show only what a member's own direct
 * link would show (e.g. the inviter on a connection offer).
 */
export type MemberTeaserIdentity = Pick<
  PublicMemberTeaserView,
  "memberId" | "displayName" | "username" | "slug" | "avatar"
>;

/**
 * One row of the caller's own "Blocked members" list (social/listMyBlocks), newest first. Just
 * enough identity to recognise and unblock the member; only the blocker ever sees it.
 */
export interface BlockedMemberView {
  memberId: string;
  /** Raw account name; may be absent. Render via resolveMemberDisplayName / useMemberDisplayName. */
  name?: string;
  avatar?: string;
  /** The /members/$handle param (slug, else username, else the member id). */
  handle: string;
  /** When the block was made (ms). */
  blockedAt: number;
}

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
  /** Resolved server-side (profile displayName → account name → username, never email); absent = render the generic member label. */
  displayName?: string;
  username?: string;
  /** The member's Convex-owned profile handle (identity/setSlug), if they've chosen one. */
  slug?: string;
  avatar?: string;
  /** users.createdAt (ms). */
  memberSince: number;
  visibility: "public" | "private";
  /** Owned-copy count; null for private profiles. */
  puzzleCount: number | null;
  /**
   * Set when the viewer blocked this member (identity only, puzzleCount null) so the UI can offer
   * Unblock. A member who blocked the viewer reads as null instead.
   */
  blockedByMe?: true;
}

/**
 * Who is asking to follow the viewer: the minimal identity the target of a PENDING follow request
 * may see to decide Approve/Decline, even when the requester's profile is private. Identity only —
 * never email, bio, location, counts or follower lists. Null unless the requester has a pending
 * request to the viewer.
 */
export interface FollowRequesterPreviewView {
  memberId: string;
  /** Resolved server-side (profile displayName → account name → username, never email); absent = render the generic member label. */
  displayName?: string;
  /** The /members/$handle param (slug, else username, else the member id). */
  handle: string;
  avatar?: string;
  /** users.createdAt (ms). */
  memberSince: number;
  visibility: "public" | "private";
  /** When the pending request was sent (ms). */
  requestedAt: number;
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
  /** Resolved server-side (profile displayName → account name → username, never email); absent = render the generic member label. */
  displayName?: string;
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
 * One in-progress solve on the profile's "Currently solving" section. STRICTER gate than
 * `unlocked`: only self, or a mutual follower of a member whose `shareInProgress` preference is
 * explicitly true, ever receives this (anonymous viewers never do — getPublicProfile is
 * unauthenticated and profiles default public). Deliberately excludes notes, photos, and
 * copy/completion ids; `thumbnailUrl` is catalog box art, never a completion photo.
 */
export interface CurrentlySolvingItemView {
  title?: string;
  pieceCount?: number;
  /** The solve's startDate, epoch ms. Future-dated starts are excluded server-side. */
  startDate: number;
  thumbnailUrl?: string;
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
      /** See CurrentlySolvingItemView — friends-only + opt-in; absent when the gate fails. */
      currentlySolving?: CurrentlySolvingItemView[];
      /**
       * Which puzzles the viewer's profile listing covers (server-computed): "all" — every owned
       * copy, for the member themself, a household mate or a mutual follower; "available" — only
       * the copies offered for swap/lend/trade, for everyone else (anonymous viewers included).
       */
      libraryScope: "all" | "available";
    }
  | {
      locked: true;
      hero: PublicProfileHero;
      /**
       * Set when the viewer blocked this member: a stub whose hero carries only identity (name,
       * avatar, handle; counts and rating zeroed, no location) so the UI can offer Unblock. A
       * member who blocked the viewer reads as null instead.
       */
      blockedByMe?: true;
    };
