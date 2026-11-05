import { Result } from "../../../../shared-kernel";
import {
  AcquisitionSource,
  CopyId,
  LibraryError,
  OwnerId,
} from "../../../domain";
import { LibraryApplicationError } from "../../errors";

// Command to patch a copy's descriptive fields. Omitted fields are left unchanged; a supplied
// `acquisition` replaces the acquisition date and source together (the paid price is kept).
export interface UpdateCopyDetailsCommand {
  readonly actingMemberId: OwnerId;
  readonly copyId: CopyId;
  readonly missingPiecesCount?: number;
  readonly notes?: string;
  readonly acquisition?: {
    readonly date?: Date;
    readonly source?: AcquisitionSource;
  };
}

export interface UpdateCopyDetails {
  (
    cmd: UpdateCopyDetailsCommand,
  ): Promise<Result<void, LibraryError | LibraryApplicationError>>;
}
