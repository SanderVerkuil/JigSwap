import { Result } from "../../../../shared-kernel";
import { CollectionId, LibraryError, OwnerId } from "../../../domain";
import { LibraryApplicationError } from "../../errors";

export interface DeleteCollectionCommand {
  readonly actingMemberId: OwnerId;
  readonly collectionId: CollectionId;
}

export interface DeleteCollection {
  (
    cmd: DeleteCollectionCommand,
  ): Promise<Result<void, LibraryError | LibraryApplicationError>>;
}
