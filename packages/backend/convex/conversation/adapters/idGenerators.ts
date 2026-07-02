import {
  toMessageId,
  toThreadId,
  type MessageId,
  type MessageIdGenerator,
  type ThreadId,
  type ThreadIdGenerator,
} from "@jigswap/domain";

// Driven adapters for the Conversation id-generator ports. crypto.randomUUID is available in the
// Convex runtime; the values are branded and persisted as the aggregate's `aggregateId` (thread)
// and the companion row's `messageId` (message).
export const threadIdGenerator: ThreadIdGenerator = {
  next: (): ThreadId => toThreadId(crypto.randomUUID()),
};

export const messageIdGenerator: MessageIdGenerator = {
  next: (): MessageId => toMessageId(crypto.randomUUID()),
};
