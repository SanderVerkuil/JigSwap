import { Result } from "../../../../shared-kernel";
import { CircleId, ConversationError, MemberId } from "../../../domain";

// The command to mirror one circle membership change into the circle's thread: `memberId`
// joined or left (left covers removal too) the circle at `at`.
export interface SyncCircleParticipantCommand {
  readonly circleId: CircleId;
  readonly memberId: MemberId;
  readonly change: "joined" | "left";
  readonly at: Date;
}

// Inbound port: apply the change to the circle's thread, if it has one, and post the matching
// join/leave system message in the same unit of work. A no-op when there is no thread yet (lazy
// creation seeds from the roster) or the change is already reflected (a replayed sync).
export interface SyncCircleParticipant {
  (cmd: SyncCircleParticipantCommand): Promise<Result<void, ConversationError>>;
}
