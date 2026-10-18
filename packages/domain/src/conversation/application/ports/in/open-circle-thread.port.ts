import { Result } from "../../../../shared-kernel";
import {
  CircleId,
  ConversationError,
  MemberId,
  ThreadId,
} from "../../../domain";
import { ConversationApplicationError } from "../../errors";

// The command to ensure a circle's thread exists. The actor is resolved from auth by the
// transport adapter and must be a current member of the circle.
export interface OpenCircleThreadCommand {
  readonly circleId: CircleId;
  readonly actorId: MemberId;
}

// Inbound port: ensure the circle's one thread exists, seeded from its roster. Idempotent per
// circle. Fails with CircleNotFound for an unknown circle and equally for a non-member actor.
export interface OpenCircleThread {
  (
    cmd: OpenCircleThreadCommand,
  ): Promise<
    Result<ThreadId, ConversationError | ConversationApplicationError>
  >;
}
