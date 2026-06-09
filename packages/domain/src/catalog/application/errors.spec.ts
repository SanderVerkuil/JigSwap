import { describe, expect, it } from "vitest";
import { toId } from "../../shared-kernel";
import { CatalogCategoryId, PuzzleDefinitionId } from "../domain";
import { CatalogApplicationError } from "./errors";

describe("CatalogApplicationError factories", () => {
  it("duplicateBarcode interpolates the barcode", () => {
    const e = CatalogApplicationError.duplicateBarcode("4006381333931");
    expect(e.code).toBe("DuplicateBarcode");
    expect(e.name).toBe("CatalogApplicationError");
    expect(e.message).toBe(
      "A puzzle definition already exists with barcode 4006381333931",
    );
  });

  it("puzzleDefinitionNotFound interpolates the id", () => {
    const id = toId<"PuzzleDefinitionId">("pd1") as PuzzleDefinitionId;
    const e = CatalogApplicationError.puzzleDefinitionNotFound(id);
    expect(e.code).toBe("PuzzleDefinitionNotFound");
    expect(e.message).toBe("Puzzle definition pd1 could not be found");
  });

  it("catalogCategoryNotFound interpolates the id", () => {
    const id = toId<"CatalogCategoryId">("cat1") as CatalogCategoryId;
    const e = CatalogApplicationError.catalogCategoryNotFound(id);
    expect(e.code).toBe("CatalogCategoryNotFound");
    expect(e.message).toBe("Catalog category cat1 could not be found");
  });
});
