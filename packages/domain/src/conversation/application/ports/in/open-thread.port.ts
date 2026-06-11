import { Result } from "../../../../shared-kernel";
import { ExchangeId, MemberId, ThreadId } from "../../../domain";

// The command to ensure a thread exists for an exchange between its two parties. Idempotent: if a
// thread already exists for the exchange its id is returned unchanged. The participant set is
// supplied by the caller (Conversation conforms to Exchange and does not load its parties).
export interface OpenThreadCommand {
  readonly exchangeId: ExchangeId;
  readonly participants: readonly MemberId[];
}

// Inbound port: the ensure-thread-for-exchange use case. Yields the thread's id (existing or
// newly opened). Has no failure mode an aggregate could express, so it returns no domain error.
export interface OpenThread {
  (cmd: OpenThreadCommand): Promise<Result<ThreadId, never>>;
}
