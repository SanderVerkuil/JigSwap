import { Result } from "../../../../shared-kernel";
import { MemberId } from "../../../domain";

// The command to mark every unread notification for a member as read.
export interface MarkAllReadCommand {
  readonly memberId: MemberId;
}

// Inbound port: the mark-all-read use case. Returns the count of notifications transitioned to
// read (those already read are untouched and not counted).
export interface MarkAllRead {
  (cmd: MarkAllReadCommand): Promise<Result<number, never>>;
}
