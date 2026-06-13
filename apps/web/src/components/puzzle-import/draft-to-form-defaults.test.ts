import { describe, expect, it } from "vitest";
import { draftToFormDefaults, type ImportedDraft } from "./draft-to-form-defaults";

const base: ImportedDraft = { title: "Puzzle 1000 pieces", sourceUrl: "https://a.com/p" };

describe("draftToFormDefaults", () => {
  it("maps present fields and blanks the rest to form-safe defaults", () => {
    const d = draftToFormDefaults({
      ...base,
      brand: "Ravensburger",
      description: "Nice",
      ean: "4005556150007",
      pieceCount: 1000,
    });
    expect(d.title).toBe("Puzzle 1000 pieces");
    expect(d.brand).toBe("Ravensburger");
    expect(d.description).toBe("Nice");
    expect(d.ean).toBe("4005556150007");
    expect(d.pieceCount).toBe(1000);
    expect(d.tags).toEqual([]);
    expect(d.image).toBeUndefined();
  });

  it("uses empty strings for missing optional text and leaves pieceCount undefined", () => {
    const d = draftToFormDefaults(base);
    expect(d.brand).toBe("");
    expect(d.ean).toBe("");
    expect(d.pieceCount).toBeUndefined();
  });
});
