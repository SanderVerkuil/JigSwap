// Conversation read-model view DTOs. A Thread is the messaging context between two members —
// either anchored to an exchange or a free-standing DM. The gateway's `conversation.*` reads
// return these. Ids are opaque strings (the web app re-casts at the edge).

import type { ProjectedMember } from "../social/social";

/** One message inside a thread, as surfaced to a participant. */
export interface ThreadMessageView {
  /** The message's MessageId (threadMessages.messageId). */
  readonly id: string;
  /**
   * Whether the VIEWER authored the message; false for the other participant's messages and for
   * system (lifecycle) messages. Viewer-relative on purpose: a thread has exactly two
   * participants, and the other one is already named (privacy-projected) by the inbox subject, so
   * no author id ever crosses the wire — a hidden member's raw id would de-anonymise them.
   */
  readonly isMine: boolean;
  /**
   * Circle threads only (they have many participants, so `isMine` alone can't say who wrote it):
   * the author, privacy-projected for the viewer. A current co-member is always named (the circle
   * reveal); a former member falls back to the ordinary rules and may be anonymous. Absent on
   * system messages and in exchange/DM threads, where the subject's `otherMember` names them.
   */
  readonly author?: ProjectedMember;
  /**
   * Circle threads only: the viewer blocked this message's author. Render it collapsed ("Message
   * from a member you blocked · Show"). Never set for the blocked side.
   */
  readonly authorBlockedByMe?: true;
  /**
   * A circle thread's join/leave row (kind "system"): `member` is who joined or left, present only
   * when the viewer could otherwise see them; absent means render "A member joined/left". Leaving
   * and removal are not told apart, and who removed someone is never said.
   */
  readonly systemEvent?: {
    readonly kind: "joined" | "left";
    readonly member?: ProjectedMember;
  };
  /**
   * An exchange thread's lifecycle row (kind "system"): the trade step it records, for the client
   * to render in the reader's language. Also set on rows stored before it existed, mapped from
   * their English body; absent on every other message.
   */
  readonly tradeEvent?: {
    readonly kind:
      | "proposed"
      | "accepted"
      | "rejected"
      | "cancelled"
      | "completed"
      | "cancelled_member_deleted";
  };
  readonly kind: "text" | "image" | "location" | "system";
  /** Text: the message. Media (image/location): the optional caption, "" when none. */
  readonly body: string;
  /** Epoch millis the message was sent. */
  readonly sentAt: number;
  /**
   * The copy the message is about (sent from a copy's "Message" action). Resolved by
   * getThreadMessages only, and only while the reader may still view the copy; absent otherwise
   * (including inbox previews).
   */
  readonly copy?: MessageCopyView;
  /**
   * Set (getThreadMessages only) when the message references a copy the reader can no longer
   * view — deleted, or its visibility changed. `copy` is absent then; the UI renders a
   * "no longer available" placeholder instead of the card.
   */
  readonly copyUnavailable?: true;
  /**
   * The media message's attachment id (image/location rows that have one). Thread reads only; the
   * inbox preview never carries it.
   */
  readonly attachmentId?: string;
  /** Set when a moderator removed the message: `body` is empty; render "Message removed". */
  readonly removed?: true;
  /**
   * A media message's attachment as this reader may see it (thread reads only): an image
   * message's photo, or a location message's place (`kind: "location"`).
   */
  readonly attachment?: MessageAttachmentView | LocationAttachmentView;
}

/**
 * A shared location (spec 2.4), for the thread's participants only. `lat`/`lng` are the shared
 * coordinates, already rounded by precision: 5 decimals when `exact`, a ~1 km grid when
 * `approximate` (render "Approximate area"). `mapUrl` is the preview rendered once at send time
 * and served from our own storage (absent when the render failed: show a text card). `openUrl`
 * opens the place on openstreetmap.org (load it only when tapped).
 */
export interface LocationAttachmentView {
  readonly kind: "location";
  readonly lat: number;
  readonly lng: number;
  readonly precision: "exact" | "approximate";
  readonly label?: string;
  readonly mapUrl?: string;
  readonly openUrl: string;
}

/** A place search result in the location picker (conversation.searchPlaces). */
export interface PlaceSearchResultView {
  readonly label: string;
  readonly lat: number;
  readonly lng: number;
}

/**
 * One server-rendered view of the location picker (conversation.renderPickerMap): a short-lived
 * image URL (deleted about 10 minutes later) of `width` x `height` pixels centred on `lat`/`lng` at
 * `zoom` (Web Mercator, 512 px tiles), with the pin at its centre.
 */
export interface PickerMapView {
  readonly url: string;
  readonly lat: number;
  readonly lng: number;
  readonly zoom: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Whether location sharing can be offered in a thread (conversation.locationAvailable).
 * `exactCurrentLocation`: the other participant is the caller's mutual follower, so the picker
 * may offer "exact" for a current-location pin (the server enforces the same rule).
 */
export interface LocationAvailabilityView {
  readonly available: boolean;
  readonly exactCurrentLocation: boolean;
}

/**
 * A message photo for one reader (spec 2026-10-20: every photo is a message from send time on).
 * - `ready`: show it (`url`/`thumbUrl`).
 * - `blurred`: show the blurhash behind "Show" (sensitive band, a sender who is not the reader's
 *   mutual follower, or a photo the reader reported); decided per reader, and carrying NO url:
 *   the tap calls conversation.revealMessageImage. Once revealed it comes back `ready` with
 *   `revealed: true`.
 * - `pending`: not reviewed yet (being checked, or the check could not run and it waits for a
 *   moderator). The recipient gets the blurhash at most (once the photo passed the CSAM hash
 *   check and was re-encoded), never a url: render "Pending review". The sender's own photo may
 *   carry its `thumbUrl` (render "Checking photo…").
 * - `rejected`: the sender's own photo the check stopped (never sent to anyone else): the refusal
 *   card with `reason` and `review`, exactly as the outbox shows it. A recipient never gets this
 *   status: they see `removed`.
 * - `removed`: removed by moderation (the check stopped it, or a moderator removed it):
 *   placeholder only. With `unavailable` its sender deleted their account (the blurhash
 *   placeholder, "Photo no longer available").
 */
export interface MessageAttachmentView {
  readonly status: "ready" | "blurred" | "pending" | "rejected" | "removed";
  readonly url?: string;
  readonly thumbUrl?: string;
  /** Pixel size, for the aspect-ratio box (absent when unknown). */
  readonly w?: number;
  readonly h?: number;
  readonly blurhash?: string;
  /** Passed the check, blurred because the sender isn't the reader's mutual follower: label it so. */
  readonly notMutual?: true;
  /** A photo that would be blurred, shown because this reader tapped Show earlier. */
  readonly revealed?: true;
  /** `removed` because the sender deleted their account, not by a moderator. */
  readonly unavailable?: true;
  /** `rejected` only: why (see PendingAttachmentView). */
  readonly reason?: "unreadable" | "flagged";
  /** `rejected` only: the "Ask for a review" progress. */
  readonly review?: "requested" | "upheld";
}

/**
 * One of the caller's own photos in a thread that is not a message: staged (`pending`), or
 * stopped by the check before it was sent (`rejected`; a photo sent while still being checked is
 * a message, see MessageAttachmentView). A rejection's `reason` is
 * `unreadable` (the file could not be decoded) or `flagged` (the automated check stopped it);
 * `review` tracks "Ask for a review". Own image only once it may be served (`thumbUrl`), else a
 * `blurhash` placeholder; a rejected photo carries neither.
 */
export interface PendingAttachmentView {
  readonly attachmentId: string;
  readonly status: "pending" | "rejected";
  /** Sent (Send was pressed) rather than only staged in the composer. */
  readonly sendRequested: boolean;
  readonly reason?: "unreadable" | "flagged";
  readonly review?: "requested" | "upheld";
  readonly thumbUrl?: string;
  readonly blurhash?: string;
  readonly w?: number;
  readonly h?: number;
  readonly createdAt: number;
}

/**
 * Which participant's copies the attach picker lists (listAttachableCopies): `mine` = the
 * caller's copies the other participant can view; `theirs` = the other participant's copies the
 * caller can view (always empty when that member is anonymised to the caller).
 */
export type AttachableCopySide = "mine" | "theirs";

/** A compact card for the copy a conversation is about. */
export interface MessageCopyView {
  /** The copy's ownedPuzzles `_id`. */
  readonly copyId: string;
  readonly title: string;
  readonly brand: string | null;
  readonly pieceCount: number | null;
  /** The copy's approved cover photo or the puzzle's box art; null when neither exists. */
  readonly coverUrl: string | null;
}

/**
 * One option in the attach picker (listAttachableCopies). `limitedAudience`: in a circle thread,
 * only some of the circle's members may see this copy; the others get an "isn't available to you"
 * placeholder in its place. Absent everywhere else.
 */
export interface AttachableCopyView extends MessageCopyView {
  readonly limitedAudience?: true;
}

/**
 * Where a copy's "Message" action lands (getCopyConversation). `unavailable`: the copy does not
 * exist or the viewer may not view it. `self`: the viewer owns it. `existing`: a DM with the
 * owner already exists — open it. `new`: no DM yet — show a composer addressed to the owner
 * (privacy-projected; their raw id never crosses the wire); `canMessage` mirrors the
 * ConnectionPolicy that startCopyConversation enforces. `ownerHidden`: the owner is anonymous to
 * the viewer, so the copy page offers no conversation (every DM is one per pair, so landing on it
 * would tie copies to one hidden owner); deliberately constant, with no thread or owner fields,
 * and startCopyConversation refuses it.
 */
export type CopyConversationView =
  | { readonly status: "unavailable" }
  | { readonly status: "self" }
  | { readonly status: "ownerHidden" }
  | { readonly status: "existing"; readonly threadId: string }
  | {
      readonly status: "new";
      readonly copy: MessageCopyView;
      readonly owner: ProjectedMember;
      readonly canMessage: boolean;
    };

/**
 * What an inbox thread is ABOUT. Exchange threads carry the exchange's identity and a cached
 * puzzle title for the list row; DM threads carry the other participant, privacy-projected
 * ({@link ProjectedMember}) so a hidden member's real identity never crosses the wire. Circle
 * threads carry the friend circle (one group thread per circle).
 */
export type InboxThreadSubjectView =
  | {
      readonly kind: "exchange";
      /** The Exchange aggregateId (raw `_id` fallback for pre-aggregateId rows). */
      readonly exchangeId: string;
      readonly exchangeType: "trade" | "sale" | "loan";
      /** The requested copy's puzzle title, if it resolves. */
      readonly puzzleTitle: string | null;
      /**
       * The trading partner (the exchange party other than the viewer), projected by the PER-TRADE
       * rule: revealed inside this exchange (a trimmed member, no avatar, when only the trade
       * reveals them), else anonymous (`departed` when their account is gone).
       */
      readonly otherMember: ProjectedMember;
      /**
       * The partner's `/members/<handle>`, only when they are visible by the ordinary rules (public
       * or mutual follower); null when anonymised, inactive, or revealed by the trade only.
       */
      readonly profileHandle: string | null;
    }
  | {
      readonly kind: "dm";
      readonly otherMember: ProjectedMember;
      /**
       * The `/members/<handle>` handle (slug ?? username ?? member id) of the other member; null
       * when they are anonymised to the viewer (their profile would be locked to them) or their
       * account is inactive.
       */
      readonly profileHandle: string | null;
    }
  | {
      readonly kind: "circle";
      /** The circle's CircleId aggregateId. */
      readonly circleId: string;
      readonly name: string;
      /** The circle's current member count (the viewer included). */
      readonly memberCount: number;
      /**
       * Up to 3 other members for the row's avatar stack: the latest message's author first (when
       * the viewer may see that message), then other current members. Privacy-projected.
       */
      readonly memberPreview: readonly ProjectedMember[];
    };

/**
 * A puzzle copy an inbox thread is about (header puzzle menu, inbox cover stack): the same compact
 * card as a message's copy, plus whose copy it is. Only copies owned by one of the thread's two
 * participants are listed, so `owner` is always one of them: `"viewer"` ("Your copy") or
 * `"other"` (name them via the subject's privacy-projected `otherMember`).
 */
export interface InboxThreadContextCopy extends MessageCopyView {
  readonly owner: "viewer" | "other";
}

/** One row of a member's inbox: the thread, its subject, and the caller's unread state. */
export interface InboxThreadView {
  /** The Thread aggregateId — also what a message notification's relatedId carries. */
  readonly threadId: string;
  readonly subject: InboxThreadSubjectView;
  /**
   * The newest message, null while the thread is empty. In a circle thread: the newest message the
   * viewer may see (never one from before they joined, so null until one arrives), with its
   * `author` for "Anna: …".
   */
  readonly lastMessage: ThreadMessageView | null;
  /**
   * Messages newer than the caller's read receipt, authored by someone else. Counting stops at
   * 50 qualifying messages, so 50 genuinely means "50 or more" and reads as "50+".
   */
  readonly unreadCount: number;
  /**
   * The DISTINCT copies the thread is about that the viewer may view right now, at most 10.
   * Exchange threads list the requested then the offered copy first; then copies referenced by
   * messages, newest reference first. Copies owned by neither participant (legacy rows) are left
   * out. Empty when none.
   */
  readonly contextCopies: readonly InboxThreadContextCopy[];
  /** Inbox ordering instant: the newest message's sentAt, or the thread's creation. */
  readonly updatedAt: number;
  /** Set when the caller muted this thread: show a grey count; it is left out of the shell badge. */
  readonly muted?: true;
  /**
   * "byMe" when the caller blocked the other participant (also when both did). The thread stays
   * listed but is read-only. Never says the other side blocked the caller; that surfaces only as
   * {@link readOnly}.
   */
  readonly blocked?: "byMe";
  /**
   * Set when the caller can't reply here for a reason the client must not tell apart: today,
   * the other participant blocked the caller. Also meant for future states such as a deleted
   * partner. Render it as the neutral "You can't reply to this conversation".
   */
  readonly readOnly?: true;
}

/**
 * How long a typing signal lives: the server stops returning a typer whose signal is older, and
 * the client hides an entry once its `ageMs` plus the time since it arrived reaches it. Shared so
 * the two can't drift.
 */
export const TYPING_TTL_MS = 6_000;

/**
 * One other participant who is typing in a thread (conversation/getTyping), as the viewer may
 * see them. `ageMs` is how long ago their indicator was refreshed, measured on the server when
 * the query ran: the client hides the entry once `ageMs` plus its own elapsed time reaches
 * {@link TYPING_TTL_MS}, so no clock comparison between the two is needed.
 */
export interface TypingView {
  readonly member: ProjectedMember;
  readonly ageMs: number;
}
