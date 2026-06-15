import { Result } from "../../../../shared-kernel";
import { CopyId, LibraryError, OwnerId } from "../../../domain";
import { LibraryApplicationError } from "../../errors";

export interface SetCopyCoverCommand {
  readonly actingMemberId: OwnerId;
  readonly copyId: CopyId;
  // The chosen `ownedPuzzleImages` id, or null to clear and fall back to the global image.
  readonly coverImageId: string | null;
}

export interface SetCopyCover {
  (
    cmd: SetCopyCoverCommand,
  ): Promise<Result<void, LibraryError | LibraryApplicationError>>;
}
