import { describe, expect, it } from "vitest";
import {
  toCollectionId,
  toCopyId,
  toPersonalCategoryId,
  toPuzzleDefinitionId,
} from "../../shared-kernel";

import { LibraryApplicationError } from "./errors";

const copy = toCopyId("copy1");

describe("LibraryApplicationError factories", () => {
  it("copyNotFound", () => {
    const e = LibraryApplicationError.copyNotFound(copy);
    expect(e.code).toBe("CopyNotFound");
    expect(e.name).toBe("LibraryApplicationError");
    expect(e.message).toBe("Copy copy1 could not be found");
  });

  it("collectionNotFound", () => {
    const id = toCollectionId("col1");
    const e = LibraryApplicationError.collectionNotFound(id);
    expect(e.code).toBe("CollectionNotFound");
    expect(e.message).toBe("Collection col1 could not be found");
  });

  it("personalCategoryNotFound", () => {
    const id = toPersonalCategoryId("cat1");
    const e = LibraryApplicationError.personalCategoryNotFound(id);
    expect(e.code).toBe("PersonalCategoryNotFound");
    expect(e.message).toBe("Personal category cat1 could not be found");
  });

  it("duplicateCollectionName", () => {
    const e = LibraryApplicationError.duplicateCollectionName("Favorites");
    expect(e.code).toBe("DuplicateCollectionName");
    expect(e.message).toBe('A collection named "Favorites" already exists');
  });

  it("notCopyOwner", () => {
    const e = LibraryApplicationError.notCopyOwner(copy);
    expect(e.code).toBe("NotCopyOwner");
    expect(e.message).toBe("Copy copy1 is not owned by the collection owner");
  });

  it("copyReserved", () => {
    const e = LibraryApplicationError.copyReserved(copy);
    expect(e.code).toBe("CopyReserved");
    expect(e.message).toBe(
      "Copy copy1 is reserved by an active exchange and cannot be made available",
    );
  });

  it("snapshotUnavailable", () => {
    const e = LibraryApplicationError.snapshotUnavailable();
    expect(e.code).toBe("SnapshotUnavailable");
    expect(e.message).toBe(
      "A Catalog snapshot could not be obtained for the puzzle definition",
    );
  });

  it("puzzleNotFound", () => {
    const id = toPuzzleDefinitionId("pd1");
    const e = LibraryApplicationError.puzzleNotFound(id);
    expect(e.code).toBe("PuzzleNotFound");
    expect(e.message).toBe("Puzzle definition pd1 could not be found");
  });

  it("puzzleNotAcquirable", () => {
    const id = toPuzzleDefinitionId("pd1");
    const e = LibraryApplicationError.puzzleNotAcquirable(id);
    expect(e.code).toBe("PuzzleNotAcquirable");
    expect(e.message).toBe("Puzzle definition pd1 is not available to acquire");
  });
});
