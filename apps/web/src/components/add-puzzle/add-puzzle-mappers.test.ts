import { describe, expect, it } from "vitest";
import {
  availabilityToSharing,
  hasAnyAvailability,
  resolveDefinitionId,
} from "./add-puzzle-mappers";

describe("resolveDefinitionId", () => {
  it("prefers the domain aggregateId when present", () => {
    expect(resolveDefinitionId("agg-1", "convex-id-1")).toBe("agg-1");
  });

  it("falls back to the raw Convex id for legacy puzzles without an aggregateId", () => {
    expect(resolveDefinitionId(undefined, "convex-id-1")).toBe("convex-id-1");
    expect(resolveDefinitionId(null, "convex-id-1")).toBe("convex-id-1");
  });

  it("returns null when neither id is available", () => {
    expect(resolveDefinitionId(undefined, undefined)).toBeNull();
    expect(resolveDefinitionId(null, null)).toBeNull();
  });
});

describe("availabilityToSharing", () => {
  it("maps availability flags to an updateSharing arg object with visibility visible", () => {
    expect(
      availabilityToSharing("copy1", {
        forTrade: true,
        forLend: false,
        forSale: true,
      }),
    ).toEqual({
      copyId: "copy1",
      visibility: "visible",
      forTrade: true,
      forLend: false,
      forSale: true,
    });
  });
});

describe("hasAnyAvailability", () => {
  it("is true when at least one flag is set", () => {
    expect(
      hasAnyAvailability({ forTrade: false, forLend: true, forSale: false }),
    ).toBe(true);
    expect(
      hasAnyAvailability({ forTrade: false, forLend: false, forSale: false }),
    ).toBe(false);
  });
});
