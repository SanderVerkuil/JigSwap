import { Result } from "../../../../shared-kernel";
import {
  AcquisitionSource,
  Condition,
  CopyId,
  LibraryError,
  OwnerId,
  Price,
  PuzzleDefinitionId,
} from "../../../domain";
import { LibraryApplicationError } from "../../errors";

// Command to acquire a copy of a known Catalog definition. The snapshot is NOT supplied by the
// caller — the use case fetches it via the CatalogSnapshotProvider (the ACL). `ownerId` is
// resolved from auth by the transport adapter.
export interface AcquireCopyCommand {
  readonly ownerId: OwnerId;
  readonly puzzleDefinitionId: PuzzleDefinitionId;
  readonly condition: Condition;
  readonly missingPiecesCount?: number;
  readonly notes?: string;
  readonly acquisition?: {
    readonly date?: Date;
    readonly source?: AcquisitionSource;
    readonly price?: Price;
  };
}

export interface AcquireCopy {
  (
    cmd: AcquireCopyCommand,
  ): Promise<Result<CopyId, LibraryError | LibraryApplicationError>>;
}
