import { Result } from "../../../../shared-kernel";
import {
  CompletionId,
  MemberId,
  SolvingError,
} from "../../../domain";
import { SolvingApplicationError } from "../../errors";

// Finish an in-progress completion. `actingMemberId` must own the completion.
export interface FinishCompletionCommand {
  readonly actingMemberId: MemberId;
  readonly completionId: CompletionId;
  readonly endDate: Date;
  readonly completionTimeMinutes?: number;
}

export interface FinishCompletion {
  (
    cmd: FinishCompletionCommand,
  ): Promise<Result<void, SolvingError | SolvingApplicationError>>;
}
