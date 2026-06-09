import { Result } from "../../../../shared-kernel";
import {
  CompletionId,
  CopyId,
  FileId,
  MemberId,
  PuzzleDefinitionId,
  SolvingError,
} from "../../../domain";

// Begin an in-progress solve. `userId` is resolved from auth by the transport adapter.
export interface StartCompletionCommand {
  readonly userId: MemberId;
  readonly puzzleDefinitionId?: PuzzleDefinitionId;
  readonly copyId?: CopyId;
  readonly startDate: Date;
  readonly notes?: string;
  readonly photoFileIds?: readonly FileId[];
}

export interface StartCompletion {
  (cmd: StartCompletionCommand): Promise<Result<CompletionId, SolvingError>>;
}
