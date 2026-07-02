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
}

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
    }
  | { readonly kind: "dm"; readonly otherMember: ProjectedMember };

/** One row of a member's inbox: the thread, its subject, and the caller's unread state. */
export interface InboxThreadView {
  /** The Thread aggregateId — also what a message notification's relatedId carries. */
  readonly threadId: string;
  readonly subject: InboxThreadSubjectView;
  /** The newest message, null while the thread is empty. */
  readonly lastMessage: ThreadMessageView | null;
  /**
   * Messages newer than the caller's read receipt, authored by someone else. Counted over at
   * most the 50 newest messages, so 50 reads as "50+".
   */
  readonly unreadCount: number;
  /** Inbox ordering instant: the newest message's sentAt, or the thread's creation. */
  readonly updatedAt: number;
}
