import { DEFAULT_COLOR_PRESETS } from "@/components/ui/color-picker";
import { describe, expect, it } from "vitest";
import { deriveColorFromName } from "./derive-color";

describe("deriveColorFromName", () => {
  it("is deterministic: the same name always derives the same color", () => {
    expect(deriveColorFromName("Fantasy")).toBe(deriveColorFromName("Fantasy"));
    expect(deriveColorFromName("Landscapes")).toBe(
      deriveColorFromName("Landscapes"),
    );
  });

  it("normalizes case and surrounding whitespace before hashing", () => {
    expect(deriveColorFromName("  Fantasy ")).toBe(
      deriveColorFromName("fantasy"),
    );
  });

  it("always lands on one of the shared color presets", () => {
    for (const name of ["Fantasy", "Landscapes", "Animals", "Art", "Maps"]) {
      expect(DEFAULT_COLOR_PRESETS).toContain(deriveColorFromName(name));
    }
  });

  it("spreads different names across multiple presets", () => {
    const colors = new Set(
      [
        "Fantasy",
        "Landscapes",
        "Animals",
        "Art",
        "Maps",
        "Space",
        "Cities",
        "Nature",
      ].map(deriveColorFromName),
    );
    expect(colors.size).toBeGreaterThan(1);
  });

  it("derives nothing from a blank name", () => {
    expect(deriveColorFromName("")).toBeNull();
    expect(deriveColorFromName("   ")).toBeNull();
  });
});
