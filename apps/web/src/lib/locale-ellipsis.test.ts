import { describe, expect, it } from "vitest";
import en from "../../locales/en.json";
import nl from "../../locales/nl.json";
import source from "../../locales/source.json";

// House style: an ellipsis is the single character "…" (U+2026), never three
// full stops ("Loading…", "Search puzzles…").

function threeDotValues(node: unknown, path: string[] = []): string[] {
  if (typeof node === "string") {
    return node.includes("...") ? [`${path.join(".")}: ${node}`] : [];
  }
  if (node && typeof node === "object") {
    return Object.entries(node).flatMap(([key, value]) =>
      threeDotValues(value, [...path, key]),
    );
  }
  return [];
}

describe("locale ellipses", () => {
  it.each([
    ["en.json", en],
    ["nl.json", nl],
    ["source.json", source],
  ])("%s uses … instead of ...", (_file, messages) => {
    expect(threeDotValues(messages)).toEqual([]);
  });
});
