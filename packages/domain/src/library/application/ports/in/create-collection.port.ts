import { Result } from "../../../../shared-kernel";
import {
  CollectionId,
  CollectionVisibility,
  LibraryError,
  OwnerId,
} from "../../../domain";
import { LibraryApplicationError } from "../../errors";

// Command to create a collection (or, with `isWishlist`, a wishlist variant).
export interface CreateCollectionCommand {
  readonly ownerId: OwnerId;
  readonly name: string;
  readonly description?: string;
  readonly visibility?: CollectionVisibility;
  readonly color?: string;
  readonly icon?: string;
  readonly isWishlist?: boolean;
  readonly personalNotes?: string;
}

export interface CreateCollection {
  (
    cmd: CreateCollectionCommand,
  ): Promise<Result<CollectionId, LibraryError | LibraryApplicationError>>;
}
