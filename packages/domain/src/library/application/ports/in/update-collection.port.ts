import { Result } from "../../../../shared-kernel";
import {
  CollectionId,
  CollectionVisibility,
  LibraryError,
  OwnerId,
} from "../../../domain";
import { LibraryApplicationError } from "../../errors";

// Command to patch a collection's mutable fields. Omitted fields are left unchanged.
export interface UpdateCollectionCommand {
  readonly actingMemberId: OwnerId;
  readonly collectionId: CollectionId;
  readonly name?: string;
  readonly description?: string;
  readonly visibility?: CollectionVisibility;
  readonly color?: string;
  readonly icon?: string;
  readonly personalNotes?: string;
}

export interface UpdateCollection {
  (
    cmd: UpdateCollectionCommand,
  ): Promise<Result<void, LibraryError | LibraryApplicationError>>;
}
