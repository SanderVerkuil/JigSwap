import { Result } from "../../../../shared-kernel";
import { CollectionId, CopyId, LibraryError, OwnerId } from "../../../domain";
import { LibraryApplicationError } from "../../errors";

// Add/remove a copy to/from a collection. `actingMemberId` must own both the collection and
// (for add) the copy — enforced in the use case.
export interface CollectionMembershipCommand {
  readonly actingMemberId: OwnerId;
  readonly collectionId: CollectionId;
  readonly copyId: CopyId;
}

export interface AddCopyToCollection {
  (
    cmd: CollectionMembershipCommand,
  ): Promise<Result<void, LibraryError | LibraryApplicationError>>;
}

export interface RemoveCopyFromCollection {
  (
    cmd: CollectionMembershipCommand,
  ): Promise<Result<void, LibraryError | LibraryApplicationError>>;
}
