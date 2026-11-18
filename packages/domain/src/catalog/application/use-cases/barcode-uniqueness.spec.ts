import { describe, expect, it } from "vitest";
import { PuzzleDefinitionRepository } from "../ports/out/puzzle-definition.repository";
import { firstDuplicateBarcode } from "./barcode-uniqueness";

// Holds `held` as a stored barcode; findByBarcode matches the exact string only, like the adapter.
const repoHolding = (held: string) =>
  ({
    findByBarcode: async (barcode: string) =>
      barcode === held ? ({} as never) : null,
  }) as unknown as PuzzleDefinitionRepository;

describe("firstDuplicateBarcode UPC-A / EAN-13 equivalence", () => {
  it("flags a 0-prefixed EAN-13 whose UPC-A twin is held", async () => {
    expect(
      await firstDuplicateBarcode(repoHolding("036000291452"), {
        ean: "0036000291452",
      }),
    ).toBe("0036000291452");
  });

  it("flags a UPC-A whose 0-prefixed EAN-13 twin is held", async () => {
    expect(
      await firstDuplicateBarcode(repoHolding("0036000291452"), {
        upc: "036000291452",
      }),
    ).toBe("036000291452");
  });
});
