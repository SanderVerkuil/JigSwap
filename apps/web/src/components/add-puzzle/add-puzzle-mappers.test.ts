import { describe, expect, it } from "vitest";
import {
  availabilityToSharing,
  hasAnyAvailability,
} from "./add-puzzle-mappers";

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

describe("availabilityToSharing visibility", () => {
  it("keeps a private choice when nothing is offered", () => {
    expect(
      availabilityToSharing(
        "copy1",
        { forTrade: false, forLend: false, forSale: false },
        "private",
      ).visibility,
    ).toBe("private");
  });

  it("forces visible when any offer is on", () => {
    for (const flags of [
      { forTrade: true, forLend: false, forSale: false },
      { forTrade: false, forLend: true, forSale: false },
      { forTrade: false, forLend: false, forSale: true },
    ]) {
      expect(availabilityToSharing("copy1", flags, "private").visibility).toBe(
        "visible",
      );
    }
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
