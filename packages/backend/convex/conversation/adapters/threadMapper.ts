import {
  Thread,
  toMemberId,
  toMessageId,
  toThreadId,
  type ExchangeId,
  type MemberId,
  type MessageState,
  type ThreadState,
  type ThreadSubject,
} from "@jigswap/domain";
import type { Doc, Id } from "../../_generated/dataModel";

// ACL between the persisted `threads`/`threadMessages` rows and the Thread aggregate. Schema
// shape stops here and never ripples into the domain.

// The insert/patch payload for the thread row (minus Convex-managed `_id`/`_creationTime`). The
// FK column `exchangeId` is excluded because the mapper is pure and cannot resolve the real
// `exchanges._id` from the subject's aggregateId — the repository resolves and supplies it, along
// with the row-lifecycle columns `createdAt`/`lastMessageAt` (neither lives on the aggregate).
export type ThreadRow = Omit<
  Doc<"threads">,
  "_id" | "_creationTime" | "exchangeId" | "createdAt" | "lastMessageAt"
>;

// The insert payload for one message companion row (messages are append-only; never patched).
export type ThreadMessageRow = Omit<
  Doc<"threadMessages">,
  "_id" | "_creationTime"
>;

// The canonical pair key backing the one-DM-per-pair rule and the `by_subject_participants`
// lookup: the participant user ids sorted and joined with "|" — inherently order-insensitive.
export const participantsKeyOf = (participants: readonly MemberId[]): string =>
  participants
    .map((memberId) => memberId as string)
    .sort()
    .join("|");

// Aggregate -> thread row payload (without the repository-filled columns).
export const toThreadRow = (thread: Thread): ThreadRow => {
  const state: ThreadState = thread.toState();
  return {
    aggregateId: state.id as string,
    subjectKind: state.subject.kind,
    participants: state.participants.map(
      (memberId) => memberId as unknown as Id<"users">,
    ),
    participantsKey: participantsKeyOf(state.participants),
    readReceipts: state.readReceipts.map((receipt) => ({
      memberId: receipt.memberId as unknown as Id<"users">,
      lastReadAt: receipt.lastReadAt.getTime(),
    })),
  };
};

// Message state -> companion row. A system message's null author maps to the column being absent.
export const toMessageRow = (
  threadAggregateId: string,
  message: MessageState,
): ThreadMessageRow => ({
  threadAggregateId,
  messageId: message.id as string,
  authorId:
    message.authorId === null
      ? undefined
      : (message.authorId as unknown as Id<"users">),
  kind: message.kind,
  body: message.body,
  sentAt: message.sentAt.getTime(),
});

// Rows -> aggregate state. `exchangeId` is the OUTBOUND aggregateId, supplied by the repository
// after mapping the stored FK `_id` back to it; it MUST be present for an exchange-kind row — a
// row claiming an exchange subject without one is corrupt, and silently hydrating it as a DM
// would erase the subject, so we refuse loudly instead.
export const toDomain = (
  row: Doc<"threads">,
  messages: readonly Doc<"threadMessages">[],
  exchangeId: ExchangeId | undefined,
): ThreadState => ({
  id: toThreadId(row.aggregateId),
  subject: toSubject(row, exchangeId),
  participants: row.participants.map((userId) => toMemberId(userId as string)),
  messages: messages.map(toMessageState),
  readReceipts: row.readReceipts.map((receipt) => ({
    memberId: toMemberId(receipt.memberId as string),
    lastReadAt: new Date(receipt.lastReadAt),
  })),
});

const toSubject = (
  row: Doc<"threads">,
  exchangeId: ExchangeId | undefined,
): ThreadSubject => {
  if (row.subjectKind === "dm") return { kind: "dm" };
  if (exchangeId === undefined) {
    throw new Error(
      `threads row ${row.aggregateId} has subjectKind "exchange" but no exchangeId; refusing to hydrate`,
    );
  }
  return { kind: "exchange", exchangeId };
};

const toMessageState = (row: Doc<"threadMessages">): MessageState => ({
  id: toMessageId(row.messageId),
  authorId:
    row.authorId === undefined ? null : toMemberId(row.authorId as string),
  kind: row.kind,
  body: row.body,
  sentAt: new Date(row.sentAt),
});
