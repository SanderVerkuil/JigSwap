import { Id } from "../../shared-kernel";

// This context's own identities. A Thread is the aggregate root; a Message is an entity within it.
export type ThreadId = Id<"ThreadId">;
export type MessageId = Id<"MessageId">;

// Foreign-aggregate references held as branded strings. Conversation never loads these
// aggregates; it only carries their ids. ExchangeId is owned by Exchange (a Thread is scoped to
// one); MemberId is owned by Identity & Access (participants and message authors). Keeping them
// branded prevents mixing an exchange id where a member id is expected. (Barrel disambiguation
// is handled at integration.)
export type ExchangeId = Id<"ExchangeId">;
export type MemberId = Id<"MemberId">;
