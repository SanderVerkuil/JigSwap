import { Result } from "../../../../shared-kernel";
import { CopyId, LibraryError, OwnerId } from "../../../domain";
import { LibraryApplicationError } from "../../errors";

// Settlement-driven: no acting member — the move is authorised by the exchange having completed.
export interface TransferCopyOwnershipCommand {
  readonly copyId: CopyId;
  readonly newOwner: OwnerId;
}

export interface TransferCopyOwnership {
  (
    cmd: TransferCopyOwnershipCommand,
  ): Promise<Result<void, LibraryError | LibraryApplicationError>>;
}
