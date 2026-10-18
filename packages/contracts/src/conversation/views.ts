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
   * inbox preview never carries it. The attachment itself is resolved by a later read model.
   */
  readonly attachmentId?: string;
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
 * Where a copy's "Message" action lands (getCopyConversation). `unavailable`: the copy does not
 * exist or the viewer may not view it. `self`: the viewer owns it. `existing`: a DM with the
 * owner already exists — open it. `new`: no DM yet — show a composer addressed to the owner
 * (privacy-projected; their raw id never crosses the wire); `canMessage` mirrors the
 * ConnectionPolicy that startCopyConversation enforces.
 */
export type CopyConversationView =
  | { readonly status: "unavailable" }
  | { readonly status: "self" }
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
 * ({@link ProjectedMember}) so a hidden member's real identity never crosses the wire.
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
  /** The newest message, null while the thread is empty. */
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
  /**
   * Set when the pair is blocked: "byMe" when the caller blocked the other participant (also
   * when both did), "byThem" when only they did. The thread stays listed but is read-only; render
   * "byThem" as the generic "You can't reply to this conversation".
   */
  readonly blocked?: "byMe" | "byThem";
}
