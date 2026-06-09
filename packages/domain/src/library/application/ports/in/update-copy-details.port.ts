import { Result } from "../../../../shared-kernel";
import { CopyId, LibraryError, OwnerId } from "../../../domain";
import { LibraryApplicationError } from "../../errors";

// Command to patch a copy's descriptive fields. Omitted fields are left unchanged.
export interface UpdateCopyDetailsCommand {
  readonly actingMemberId: OwnerId;
  readonly copyId: CopyId;
  readonly missingPiecesCount?: number;
  readonly notes?: string;
}

export interface UpdateCopyDetails {
  (
    cmd: UpdateCopyDetailsCommand,
  ): Promise<Result<void, LibraryError | LibraryApplicationError>>;
}
