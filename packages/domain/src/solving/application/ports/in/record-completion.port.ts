import { Result } from "../../../../shared-kernel";
import {
  CompletionId,
  CopyId,
  DatePrecision,
  FileId,
  MemberId,
  PuzzleDefinitionId,
  SolvingError,
} from "../../../domain";

// Log an already-finished solve. The duration is derived from start/end when omitted. The
// precision defaults to "day", which needs both dates; "year" needs `year`; "unknown" takes no date.
export interface RecordCompletionCommand {
  readonly userId: MemberId;
  readonly puzzleDefinitionId?: PuzzleDefinitionId;
  readonly copyId?: CopyId;
  readonly datePrecision?: DatePrecision;
  readonly startDate?: Date;
  readonly endDate?: Date;
  readonly year?: number;
  readonly completionTimeMinutes?: number;
  readonly notes?: string;
  readonly photoFileIds?: readonly FileId[];
  readonly allPiecesPresent?: boolean;
  // Part of a batch backfill (recordPastCompletions); the feed skips these.
  readonly bulk?: boolean;
}

export interface RecordCompletion {
  (cmd: RecordCompletionCommand): Promise<Result<CompletionId, SolvingError>>;
}
