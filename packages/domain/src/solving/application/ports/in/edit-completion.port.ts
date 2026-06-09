import { Result } from "../../../../shared-kernel";
import {
  CompletionId,
  FileId,
  MemberId,
  SolvingError,
} from "../../../domain";
import { SolvingApplicationError } from "../../errors";

// Edit a completion's mutable fields. Enforces the 24h edit window and ownership in the aggregate.
export interface EditCompletionCommand {
  readonly actingMemberId: MemberId;
  readonly completionId: CompletionId;
  readonly notes?: string;
  readonly photoFileIds?: readonly FileId[];
  readonly startDate?: Date;
  readonly endDate?: Date;
  readonly completionTimeMinutes?: number;
}

export interface EditCompletion {
  (
    cmd: EditCompletionCommand,
  ): Promise<Result<void, SolvingError | SolvingApplicationError>>;
}
