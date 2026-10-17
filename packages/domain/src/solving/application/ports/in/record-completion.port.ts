import { Result } from "../../../../shared-kernel";
import {
  CompletionId,
  CopyId,
  FileId,
  MemberId,
  PuzzleDefinitionId,
  SolvingError,
} from "../../../domain";

// Log an already-finished solve. The duration is derived from start/end when omitted.
export interface RecordCompletionCommand {
  readonly userId: MemberId;
  readonly puzzleDefinitionId?: PuzzleDefinitionId;
  readonly copyId?: CopyId;
  readonly startDate: Date;
  readonly endDate: Date;
  readonly completionTimeMinutes?: number;
  readonly notes?: string;
  readonly photoFileIds?: readonly FileId[];
  readonly allPiecesPresent?: boolean;
}

export interface RecordCompletion {
  (cmd: RecordCompletionCommand): Promise<Result<CompletionId, SolvingError>>;
}
