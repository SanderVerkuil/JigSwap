import { Result } from "../../../../shared-kernel";
import { ConversationError, MemberId, ThreadId } from "../../../domain";
import { ConversationApplicationError } from "../../errors";

// The command to ensure a DM thread exists between the pair. The initiator is resolved from auth
// by the transport adapter; the recipient is the member they want to message.
export interface OpenDmThreadCommand {
  readonly initiatorId: MemberId;
  readonly recipientId: MemberId;
}

// Inbound port: ensure a DM thread exists between the pair. Idempotent per pair (either argument
// order yields the same thread). Fails on a self-DM (domain) or an unconnected pair (application).
export interface OpenDmThread {
  (
    cmd: OpenDmThreadCommand,
  ): Promise<
    Result<ThreadId, ConversationError | ConversationApplicationError>
  >;
}
