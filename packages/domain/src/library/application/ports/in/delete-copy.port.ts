import { Result } from "../../../../shared-kernel";
import { CopyId, LibraryError, OwnerId } from "../../../domain";
import { LibraryApplicationError } from "../../errors";

export interface DeleteCopyCommand {
  readonly actingMemberId: OwnerId;
  readonly copyId: CopyId;
}

export interface DeleteCopy {
  (
    cmd: DeleteCopyCommand,
  ): Promise<Result<void, LibraryError | LibraryApplicationError>>;
}
