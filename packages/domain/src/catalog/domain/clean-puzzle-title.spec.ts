// packages/domain/src/catalog/domain/clean-puzzle-title.spec.ts
import { describe, expect, it } from "vitest";
import { cleanPuzzleTitle } from "./clean-puzzle-title";

describe("cleanPuzzleTitle", () => {
  it("strips piece count and noise segments (Dutch)", () => {
    expect(
      cleanPuzzleTitle(
        "Jan van Haasteren Jungletocht - 1000 stukjes puzzel - Gerecycled karton",
      ),
    ).toBe("Jan van Haasteren Jungletocht");
  });

  it("strips trailing piece count phrase (English)", () => {
    expect(cleanPuzzleTitle("Ravensburger Mountain Vista 1000 pieces")).toBe(
      "Ravensburger Mountain Vista",
    );
  });

  it("leaves a clean title untouched", () => {
    expect(cleanPuzzleTitle("Starry Night")).toBe("Starry Night");
  });

  it("joins kept segments with a space and drops the separator", () => {
    // "Educa" and "Sterrenhemel" both survive; "1500 stukjes" is dropped
    expect(cleanPuzzleTitle("Educa - Sterrenhemel - 1500 stukjes")).toBe(
      "Educa Sterrenhemel",
    );
  });

  it("returns trimmed input when result would be empty", () => {
    expect(cleanPuzzleTitle("  puzzel  ")).toBe("puzzel");
    expect(cleanPuzzleTitle("1000 stukjes")).toBe("1000 stukjes");
  });

  it("handles empty string input", () => {
    expect(cleanPuzzleTitle("")).toBe("");
  });

  it("handles whitespace-only input", () => {
    expect(cleanPuzzleTitle("   ")).toBe("");
  });

  it("strips noise words mid-segment", () => {
    // "jigsaw" and "puzzle" are noise words, get removed
    expect(cleanPuzzleTitle("City Skyline Jigsaw Puzzle")).toBe("City Skyline");
  });

  it("strips German Teile piece count", () => {
    expect(cleanPuzzleTitle("Berglandschaft 500 Teile Puzzle")).toBe(
      "Berglandschaft",
    );
  });

  it("strips thousands-separator piece counts", () => {
    expect(cleanPuzzleTitle("Beautiful Landscape 1.000 stukjes")).toBe(
      "Beautiful Landscape",
    );
  });

  it("drops audience segment (adults)", () => {
    expect(cleanPuzzleTitle("Flower Garden Puzzle - 500 pieces - Adults")).toBe(
      "Flower Garden",
    );
  });

  it("drops material segment (cardboard)", () => {
    expect(
      cleanPuzzleTitle("Ocean View - 1000 pieces - Recycled cardboard"),
    ).toBe("Ocean View");
  });
});
