// Conversation read-model view DTOs. A Thread is the messaging context between two members —
// either anchored to an exchange or a free-standing DM. The gateway's `conversation.*` reads
// return these. Ids are opaque strings (the web app re-casts at the edge).

import type { ProjectedMember } from "../social/social";

/** One message inside a thread, as surfaced to a participant. */
export interface ThreadMessageView {
  /** The message's MessageId (threadMessages.messageId). */
  readonly id: string;
  /** The authoring member's user _id; null for system (lifecycle) messages. */
  readonly authorId: string | null;
  readonly kind: "text" | "image" | "system";
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
}

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
      /** The trading partner (the exchange party other than the viewer), privacy-projected. */
      readonly otherMember: ProjectedMember;
      /** As on a DM subject: the partner's `/members/<handle>`, null when anonymised or inactive. */
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
 * A puzzle copy an inbox thread is about (header puzzle menu, inbox cover stack). The same compact
 * card as a message's copy: id, title, brand, piece count and cover.
 */
export type InboxThreadContextCopy = MessageCopyView;

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
   * messages, newest reference first (scanning at most the newest 500 messages). Empty when none.
   */
  readonly contextCopies: readonly InboxThreadContextCopy[];
  /** Inbox ordering instant: the newest message's sentAt, or the thread's creation. */
  readonly updatedAt: number;
}
