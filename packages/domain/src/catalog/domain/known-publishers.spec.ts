import { describe, expect, it } from "vitest";
import { KNOWN_PUBLISHERS, matchKnownPublisher } from "./known-publishers";

describe("matchKnownPublisher", () => {
  it("matches case-insensitively and returns canonical casing", () => {
    expect(matchKnownPublisher("ravensburger")).toBe("Ravensburger");
    expect(matchKnownPublisher("JUMBO")).toBe("Jumbo");
  });

  it("trims surrounding whitespace", () => {
    expect(matchKnownPublisher("  Falcon ")).toBe("Falcon");
  });

  it("returns undefined for product lines and unknowns", () => {
    expect(matchKnownPublisher("Jan van Haasteren")).toBeUndefined();
    expect(matchKnownPublisher("Wasgij")).toBeUndefined();
    expect(matchKnownPublisher("")).toBeUndefined();
  });

  it("exposes the allowlist for suggestion seeding", () => {
    expect(KNOWN_PUBLISHERS).toContain("Jumbo");
    expect(KNOWN_PUBLISHERS).toContain("Ravensburger");
    expect(KNOWN_PUBLISHERS.length).toBeGreaterThanOrEqual(12);
  });
});
