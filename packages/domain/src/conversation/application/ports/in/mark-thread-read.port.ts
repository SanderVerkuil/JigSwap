import { Result } from "../../../../shared-kernel";
import { ConversationError, MemberId, ThreadId } from "../../../domain";
import { ConversationApplicationError } from "../../errors";

// The command for a participant to mark a thread read up to now. `memberId` is resolved from auth
// by the transport adapter; the read instant is the clock's `now`.
export interface MarkThreadReadCommand {
  readonly threadId: ThreadId;
  readonly memberId: MemberId;
}

// Inbound port: the mark-thread-read use case. Updates only the caller's read receipt.
export interface MarkThreadRead {
  (
    cmd: MarkThreadReadCommand,
  ): Promise<Result<void, ConversationError | ConversationApplicationError>>;
}
