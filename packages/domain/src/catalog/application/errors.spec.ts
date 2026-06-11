import { describe, expect, it } from "vitest";
import { toCatalogCategoryId, toPuzzleDefinitionId } from "../../shared-kernel";

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
    const id = toPuzzleDefinitionId("pd1");
    const e = CatalogApplicationError.puzzleDefinitionNotFound(id);
    expect(e.code).toBe("PuzzleDefinitionNotFound");
    expect(e.message).toBe("Puzzle definition pd1 could not be found");
  });

  it("catalogCategoryNotFound interpolates the id", () => {
    const id = toCatalogCategoryId("cat1");
    const e = CatalogApplicationError.catalogCategoryNotFound(id);
    expect(e.code).toBe("CatalogCategoryNotFound");
    expect(e.message).toBe("Catalog category cat1 could not be found");
  });
});
