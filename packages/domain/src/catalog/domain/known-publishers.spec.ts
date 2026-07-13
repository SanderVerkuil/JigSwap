import { describe, expect, test } from "vitest";
import { matchKnownPublisher } from "./known-publishers";

describe("matchKnownPublisher", () => {
  test("matches case-insensitively and returns canonical casing", () => {
    expect(matchKnownPublisher("ravensburger")).toBe("Ravensburger");
    expect(matchKnownPublisher("JUMBO")).toBe("Jumbo");
  });

  test("trims surrounding whitespace", () => {
    expect(matchKnownPublisher("  Falcon ")).toBe("Falcon");
  });

  test("returns undefined for product lines and unknowns", () => {
    expect(matchKnownPublisher("Jan van Haasteren")).toBeUndefined();
    expect(matchKnownPublisher("Wasgij")).toBeUndefined();
    expect(matchKnownPublisher("")).toBeUndefined();
  });
});
