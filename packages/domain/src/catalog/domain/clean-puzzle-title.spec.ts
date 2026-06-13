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

  // ---- Mutation-targeted cases ----

  it("keeps every non-descriptor segment instead of dropping all (L26 conditional)", () => {
    // If isAllDescriptors always returned true, both segments would be dropped
    // and the function would fall back to the raw input "Educa - Sterrenhemel".
    expect(cleanPuzzleTitle("Educa - Sterrenhemel")).toBe("Educa Sterrenhemel");
  });

  it("keeps a mixed segment where only some words are descriptors (L26 every vs some)", () => {
    // "Forest Recycled" mixes a real word with a descriptor word. `every` keeps it
    // (not ALL words are descriptors); a `some` mutant would drop it, yielding "Sunset".
    expect(cleanPuzzleTitle("Sunset - Forest Recycled")).toBe(
      "Sunset Forest Recycled",
    );
  });

  it("collapses internal whitespace left by mid-segment noise removal (L53 \\s+ vs \\s)", () => {
    // Removing the middle "Jigsaw" leaves a double space; it must collapse to one.
    // A /\s/g mutant would leave "City  Skyline" with two spaces.
    expect(cleanPuzzleTitle("City Jigsaw Skyline")).toBe("City Skyline");
  });

  it("strips a piece count written with an internal space separator (L6 \\s in number)", () => {
    // "1 000" can only match via the first alternative \d[\d.,\s]{0,7}\d.
    // A \S mutant would break on the space and leave "Vista 1".
    expect(cleanPuzzleTitle("Vista 1 000 stukjes")).toBe("Vista");
  });

  it("does NOT strip a number that ends in a separator before the unit (L6 trailing \\d)", () => {
    // "1." is not a valid piece count: the number must end in a digit.
    // A \D mutant would wrongly strip "1. pieces".
    expect(cleanPuzzleTitle("Vista 1. pieces")).toBe("Vista 1. pieces");
  });

  it("strips a long pure-digit piece count beyond the {0,7} window (L6 \\d+ vs \\d)", () => {
    // A 10-digit number exceeds the first alternative's length cap, so it relies on
    // the \d+ alternative. A single-\d mutant would leave "Vista 1".
    expect(cleanPuzzleTitle("Vista 1234567890 pieces")).toBe("Vista");
  });

  it("strips a single-digit piece count (L6 \\d+ vs \\D+ alternative)", () => {
    // A \D+ mutant for the second alternative would fail on the digit "5".
    expect(cleanPuzzleTitle("Vista 5 pieces")).toBe("Vista");
  });

  it("strips a piece count with multiple spaces before the unit (L6 \\s* vs \\s)", () => {
    // Two spaces between number and unit require \s*; a single-\s mutant leaves it.
    expect(cleanPuzzleTitle("Vista 1000  pieces")).toBe("Vista");
  });

  it("strips the singular 'piece' unit (L6 pieces? optional s)", () => {
    // The trailing "?" makes the plural "s" optional; dropping it breaks "1 piece".
    expect(cleanPuzzleTitle("Vista 1 piece")).toBe("Vista");
  });

  it("strips the accented French 'pièces' unit (L6 pi[eè]ces character class)", () => {
    // Removing 'è' from the character class would leave "Vista 1000 pièces".
    expect(cleanPuzzleTitle("Vista 1000 pièces")).toBe("Vista");
  });

  it("does NOT drop a word that merely ends with a descriptor (L15 ^ anchor)", () => {
    // "Suncardboard" ends in "cardboard" but is not itself a descriptor.
    // Without the ^ anchor the whole segment would be dropped, yielding "Title".
    expect(cleanPuzzleTitle("Title - Suncardboard")).toBe("Title Suncardboard");
  });

  it("splits on a pipe separator (L18 [|] character class)", () => {
    // A [^|] mutant would not treat " | " as a separator, leaving "A | B".
    expect(cleanPuzzleTitle("A | B")).toBe("A B");
  });

  it("splits on a slash separator", () => {
    expect(cleanPuzzleTitle("A / B")).toBe("A B");
  });

  it("is idempotent on an already-cleaned title", () => {
    const once = cleanPuzzleTitle("Ravensburger Mountain Vista 1000 pieces");
    expect(cleanPuzzleTitle(once)).toBe(once);
  });

  // --- Age-descriptor sub-pattern (`\d+\+?\s*(?:jaar|years|yr)`) precision ---
  // These pin the anchors and quantifiers of the age descriptor inside DESCRIPTOR_WORD_RE.

  it("keeps a word that merely STARTS with a descriptor (trailing `$` anchor)", () => {
    // "Kartonnen" is not the bare descriptor "karton"; without the `$` anchor a mutant would
    // match the "karton" prefix and wrongly drop the segment.
    expect(cleanPuzzleTitle("Castle - Kartonnen")).toBe("Castle Kartonnen");
  });

  it("drops a multi-digit age descriptor (`\\d+` quantifier)", () => {
    // "10+jaar" needs `\d+` (two digits) — a `\d`/`\D+` mutant fails to match and keeps it.
    expect(cleanPuzzleTitle("Castle - 10+jaar")).toBe("Castle");
  });

  it("drops an age descriptor with no `+` and no space (`\\+?` / `\\s*` optional)", () => {
    // "8jaar" has neither the optional `+` nor whitespace; mandatory `\+`/`\s` mutants keep it.
    expect(cleanPuzzleTitle("Castle - 8jaar")).toBe("Castle");
  });

  it("keeps an age token with non-space junk before the unit (`\\s*` not `\\S*`)", () => {
    // "8xjaar" must NOT be treated as an age descriptor; a `\S*` mutant would match the "x".
    expect(cleanPuzzleTitle("Castle - 8xjaar")).toBe("Castle 8xjaar");
  });
});
