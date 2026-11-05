import { describe, expect, it } from "vitest";
import {
  foldDiacritics,
  puzzleSearchableText,
  puzzleSearchTerm,
} from "./puzzle-searchable-text";

describe("foldDiacritics", () => {
  it("strips accents and keeps everything else", () => {
    expect(foldDiacritics("Café Crème, Zürich & España 1000")).toBe(
      "Cafe Creme, Zurich & Espana 1000",
    );
  });
});

describe("puzzleSearchableText", () => {
  it("stores every field without accents, so an unaccented search finds it", () => {
    expect(
      puzzleSearchableText({
        title: "Café",
        brand: "Crème",
        publisher: "Goliath",
        artist: "Renée",
        series: "Château",
        tags: ["été"],
      }),
    ).toBe("Cafe Creme Goliath Renee Chateau ete");
  });
});

describe("puzzleSearchTerm", () => {
  it("is the trimmed, lowercased term when it has no accents", () => {
    expect(puzzleSearchTerm("  Cafe Paris ")).toBe("cafe paris");
    expect(puzzleSearchTerm("   ")).toBe("");
  });

  it("asks for the folded words, and the accented ones a row not yet backfilled still holds", () => {
    expect(puzzleSearchTerm("Café")).toBe("café cafe");
    expect(puzzleSearchTerm("grand café")).toBe("café grand cafe");
  });

  it("keeps the word being typed last, because the index prefix-matches only the last word", () => {
    expect(puzzleSearchTerm("café gra")).toBe("café cafe gra");
  });
});
