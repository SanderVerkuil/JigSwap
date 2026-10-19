import {
  Thread,
  toCircleId,
  toMemberId,
  toThreadId,
  type ExchangeId,
  type MemberId,
  type MessageState,
  type ReadReceipt,
  type ThreadState,
  type ThreadSubject,
} from "@jigswap/domain";
import type { Doc, Id } from "../../_generated/dataModel";

// ACL between the persisted `threads`/`threadMessages`/`threadParticipants` rows and the Thread
// aggregate. Schema shape stops here and never ripples into the domain.

// The insert/patch payload for the thread row (minus Convex-managed `_id`/`_creationTime`). The
// FK column `exchangeId` is excluded because the mapper is pure and cannot resolve the real
// `exchanges._id` from the subject's aggregateId — the repository resolves and supplies it, along
// with the row-lifecycle columns `createdAt`/`lastMessageAt`/`lastMessage` (none lives on the
// aggregate). Read receipts are not part of it: they persist on the participant rows.
export type ThreadRow = Omit<
  Doc<"threads">,
  | "_id"
  | "_creationTime"
  | "exchangeId"
  | "createdAt"
  | "lastMessageAt"
  | "lastMessage"
  | "readReceipts"
>;

// The inbox summary keeps at most this many code points of the newest message's body. The inbox
// row shows a one-line, ellipsised snippet, so 280 is ample.
export const LAST_MESSAGE_BODY_MAX = 280;

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

// A circle thread's participantsKey: one per circle, and never equal to a pair key (no user id
// contains ":"), so the pair lookups (one DM per pair, the ConnectionPolicy) never match it.
export const circleParticipantsKeyOf = (circleId: string): string =>
  `circle:${circleId}`;

// Aggregate -> thread row payload (without the repository-filled columns). A circle thread
// carries its CircleId in `circleId` and keys on the circle rather than on its (moving) members;
// its members' joinedAt persist on their participant rows (participantJoinedAtOf).
export const toThreadRow = (thread: Thread): ThreadRow => {
  const state: ThreadState = thread.toState();
  const participants = thread.participants.map(
    (memberId) => memberId as unknown as Id<"users">,
  );
  if (state.subject.kind === "circle") {
    const circleId = state.subject.circleId as string;
    return {
      aggregateId: state.id as string,
      subjectKind: "circle",
      circleId,
      participants,
      participantsKey: circleParticipantsKeyOf(circleId),
    };
  }
  return {
    aggregateId: state.id as string,
    subjectKind: state.subject.kind,
    participants,
    participantsKey: participantsKeyOf(thread.participants),
  };
};

// The joinedAt (epoch millis) each current participant's row is inserted with: their circle
// history floor. Absent for exchange/DM participants, which have none.
export const participantJoinedAtOf = (
  thread: Thread,
): ReadonlyMap<string, number> =>
  new Map(
    thread
      .toState()
      .participants.flatMap((p) =>
        p.joinedAt === undefined
          ? []
          : [[p.memberId as string, p.joinedAt.getTime()] as const],
      ),
  );

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
  // The domain carries the copy's ownedPuzzles `_id` as an opaque CopyId; absent stays absent.
  ...(message.copyId !== undefined && {
    copyId: message.copyId as unknown as Id<"ownedPuzzles">,
  }),
  // The domain's opaque attachmentRef is the messageAttachments row id; absent stays absent.
  ...(message.attachmentRef !== undefined && {
    attachmentId: message.attachmentRef as Id<"messageAttachments">,
  }),
  ...(message.systemEvent !== undefined && {
    systemEvent: {
      kind: message.systemEvent.kind,
      memberId: message.systemEvent.memberId as unknown as Id<"users">,
    },
  }),
  ...(message.tradeEvent !== undefined && {
    tradeEvent: { kind: message.tradeEvent.kind },
  }),
});

// Whether a row's body must never reach a renderer: a media row (image/location) WITHOUT an
// attachment. Legacy image rows were written by the old postMessage, whose image body was an
// unverified client string (never screened or ownership-checked).
export const isUnattachedMedia = (
  row: Pick<ThreadMessageRow, "kind" | "attachmentId">,
): boolean =>
  (row.kind === "image" || row.kind === "location") &&
  row.attachmentId === undefined;

// Message row -> the thread's denormalized `lastMessage` summary: body truncated to
// LAST_MESSAGE_BODY_MAX code points (never splitting a surrogate pair, which would be invalid
// Unicode and could fail the write). A media row's body is its caption ("" when none), so the
// inbox can render "Photo" / "Location" from `kind`; the attachment ref is never copied. A media
// row without an attachment (legacy image rows) is blanked: its body is an unverified client
// string that must never reach a renderer. A moderator-removed row is blanked and flagged.
export const toLastMessage = (
  row: ThreadMessageRow,
): NonNullable<Doc<"threads">["lastMessage"]> => ({
  messageId: row.messageId,
  ...(row.authorId !== undefined && { authorId: row.authorId }),
  kind: row.kind,
  body:
    isUnattachedMedia(row) || row.removedAt !== undefined
      ? ""
      : Array.from(row.body).slice(0, LAST_MESSAGE_BODY_MAX).join(""),
  sentAt: row.sentAt,
  ...(row.removedAt !== undefined
    ? { removed: true as const }
    : row.copyId !== undefined && { copyId: row.copyId }),
  ...(row.systemEvent !== undefined && { systemEvent: row.systemEvent }),
  ...(row.tradeEvent !== undefined && { tradeEvent: row.tradeEvent }),
});

// Rows -> aggregate state. `exchangeId` is the OUTBOUND aggregateId, supplied by the repository
// after mapping the stored FK `_id` back to it; it MUST be present for an exchange-kind row — a
// row claiming an exchange subject without one is corrupt, and silently hydrating it as a DM
// would erase the subject, so we refuse loudly instead.
// History never hydrates: the aggregate holds only the messages appended in this unit of work.
// Receipts come from the participant rows' `lastReadAt`, falling back to the legacy
// `threads.readReceipts` entry for members whose row has none yet (pre-backfill).
export const toDomain = (
  row: Doc<"threads">,
  participantRows: readonly Doc<"threadParticipants">[],
  exchangeId: ExchangeId | undefined,
): ThreadState => {
  const joinedAtOf = new Map(
    participantRows.flatMap((p) =>
      p.joinedAt === undefined ? [] : [[p.memberId as string, p.joinedAt]],
    ),
  );
  return {
    id: toThreadId(row.aggregateId),
    subject: toSubject(row, exchangeId),
    // A circle participant's joinedAt is on their row; exchange/DM rows carry none (their floor
    // is the thread's start).
    participants: row.participants.map((userId) => {
      const joinedAt = joinedAtOf.get(userId as string);
      return {
        memberId: toMemberId(userId as string),
        ...(joinedAt !== undefined && { joinedAt: new Date(joinedAt) }),
      };
    }),
    messages: [],
    readReceipts: toReadReceipts(row, participantRows),
  };
};

const toReadReceipts = (
  row: Doc<"threads">,
  participantRows: readonly Doc<"threadParticipants">[],
): ReadReceipt[] => {
  const lastReadAt = new Map<string, number>();
  for (const receipt of row.readReceipts ?? []) {
    lastReadAt.set(receipt.memberId as string, receipt.lastReadAt);
  }
  for (const participant of participantRows) {
    if (participant.lastReadAt !== undefined) {
      lastReadAt.set(participant.memberId as string, participant.lastReadAt);
    }
  }
  return [...lastReadAt].map(([memberId, at]) => ({
    memberId: toMemberId(memberId),
    lastReadAt: new Date(at),
  }));
};

const toSubject = (
  row: Doc<"threads">,
  exchangeId: ExchangeId | undefined,
): ThreadSubject => {
  if (row.subjectKind === "dm") return { kind: "dm" };
  if (row.subjectKind === "circle") {
    if (row.circleId === undefined) {
      throw new Error(
        `threads row ${row.aggregateId} has subjectKind "circle" but no circleId; refusing to hydrate`,
      );
    }
    return { kind: "circle", circleId: toCircleId(row.circleId) };
  }
  if (exchangeId === undefined) {
    throw new Error(
      `threads row ${row.aggregateId} has subjectKind "exchange" but no exchangeId; refusing to hydrate`,
    );
  }
  return { kind: "exchange", exchangeId };
};
