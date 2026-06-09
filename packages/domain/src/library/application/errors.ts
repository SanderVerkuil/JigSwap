import { DomainError } from "../../shared-kernel";
import {
  CollectionId,
  CopyId,
  PersonalCategoryId,
  PuzzleDefinitionId,
} from "../domain";

// Orchestration-level failures the aggregates cannot express because they depend on the world
// (other aggregates' state, repository lookups) rather than their own data. Like LibraryError,
// the `code` is the stable, machine-readable discriminant a transport adapter maps to; the
// message is for logs/tests only.
export type LibraryApplicationErrorCode =
  | "CopyNotFound"
  | "CollectionNotFound"
  | "PersonalCategoryNotFound"
  | "DuplicateCollectionName"
  | "NotCopyOwner"
  | "CopyReserved"
  | "SnapshotUnavailable"
  | "PuzzleNotFound"
  | "PuzzleNotAcquirable";

export class LibraryApplicationError extends DomainError {
  override readonly name = "LibraryApplicationError";

  private constructor(
    readonly code: LibraryApplicationErrorCode,
    message: string,
  ) {
    super(message);
  }

  static copyNotFound(copyId: CopyId): LibraryApplicationError {
    return new LibraryApplicationError(
      "CopyNotFound",
      `Copy ${copyId} could not be found`,
    );
  }

  static collectionNotFound(
    collectionId: CollectionId,
  ): LibraryApplicationError {
    return new LibraryApplicationError(
      "CollectionNotFound",
      `Collection ${collectionId} could not be found`,
    );
  }

  static personalCategoryNotFound(
    id: PersonalCategoryId,
  ): LibraryApplicationError {
    return new LibraryApplicationError(
      "PersonalCategoryNotFound",
      `Personal category ${id} could not be found`,
    );
  }

  // Two collections of the same owner cannot share a name (checked via the repository).
  static duplicateCollectionName(name: string): LibraryApplicationError {
    return new LibraryApplicationError(
      "DuplicateCollectionName",
      `A collection named "${name}" already exists`,
    );
  }

  // A copy added to a collection must belong to the collection's owner.
  static notCopyOwner(copyId: CopyId): LibraryApplicationError {
    return new LibraryApplicationError(
      "NotCopyOwner",
      `Copy ${copyId} is not owned by the collection owner`,
    );
  }

  // The copy is reserved by an active Exchange, so it cannot be made available.
  static copyReserved(copyId: CopyId): LibraryApplicationError {
    return new LibraryApplicationError(
      "CopyReserved",
      `Copy ${copyId} is reserved by an active exchange and cannot be made available`,
    );
  }

  // The Catalog ACL could not supply a snapshot for the requested definition.
  static snapshotUnavailable(): LibraryApplicationError {
    return new LibraryApplicationError(
      "SnapshotUnavailable",
      "A Catalog snapshot could not be obtained for the puzzle definition",
    );
  }

  // The Catalog has no definition with this id (so it cannot be acquired).
  static puzzleNotFound(
    puzzleDefinitionId: PuzzleDefinitionId,
  ): LibraryApplicationError {
    return new LibraryApplicationError(
      "PuzzleNotFound",
      `Puzzle definition ${puzzleDefinitionId} could not be found`,
    );
  }

  // The definition exists but the member may not acquire it: it is not approved and the member
  // is not its submitter. (A member may always acquire their own pending/rejected contribution.)
  static puzzleNotAcquirable(
    puzzleDefinitionId: PuzzleDefinitionId,
  ): LibraryApplicationError {
    return new LibraryApplicationError(
      "PuzzleNotAcquirable",
      `Puzzle definition ${puzzleDefinitionId} is not available to acquire`,
    );
  }
}
