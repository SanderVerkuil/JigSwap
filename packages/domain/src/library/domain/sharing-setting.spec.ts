import { describe, expect, it } from "vitest";
import { Price } from "./price";
import { SharingSetting } from "./sharing-setting";

describe("SharingSetting", () => {
  it("newCopy() is visible and offered for nothing", () => {
    const s = SharingSetting.newCopy();
    expect(s.visibility).toBe("visible");
    expect(s.isAvailableFor("trade")).toBe(false);
    expect(s.isAvailableFor("sale")).toBe(false);
    expect(s.isAvailableFor("lend")).toBe(false);
    expect(s.salePrice).toBeUndefined();
    expect(s.isPubliclyVisible()).toBe(true);
  });

  it("a private, non-offered copy is not publicly visible", () => {
    const s = SharingSetting.create({ visibility: "private" });
    expect(s.isPubliclyVisible()).toBe(false);
    expect(s.effectiveVisibility()).toBe("private");
  });

  it("withoutOffers() keeps the visibility and withdraws every offer and the sale price", () => {
    const offered = SharingSetting.create({
      visibility: "visible",
      forTrade: true,
      forSale: true,
      forLend: true,
      salePrice: Price.fromState(1500, "EUR"),
    });
    const withdrawn = offered.withoutOffers();
    expect(withdrawn.visibility).toBe("visible");
    expect(withdrawn.forTrade).toBe(false);
    expect(withdrawn.forSale).toBe(false);
    expect(withdrawn.forLend).toBe(false);
    expect(withdrawn.salePrice).toBeUndefined();
    expect(
      SharingSetting.create({ visibility: "private" }).withoutOffers()
        .visibility,
    ).toBe("private");
  });

  it.each([
    ["trade", { forTrade: true }],
    ["sale", { forSale: true }],
    ["lend", { forLend: true }],
  ] as const)(
    "a private copy offered for %s keeps the owner's private choice but is effectively visible",
    (_kind, flags) => {
      const offered = SharingSetting.create({
        visibility: "private",
        ...flags,
      });
      expect(offered.visibility).toBe("private");
      expect(offered.effectiveVisibility()).toBe("visible");
      expect(offered.isPubliclyVisible()).toBe(true);
      // Withdrawing every offer restores the owner's choice.
      const withdrawn = offered.withoutOffers();
      expect(withdrawn.visibility).toBe("private");
      expect(withdrawn.effectiveVisibility()).toBe("private");
      expect(withdrawn.isPubliclyVisible()).toBe(false);
    },
  );

  it("effectiveVisibility() of a visible copy is visible with or without offers", () => {
    expect(
      SharingSetting.create({ visibility: "visible" }).effectiveVisibility(),
    ).toBe("visible");
    expect(
      SharingSetting.create({
        visibility: "visible",
        forLend: true,
      }).effectiveVisibility(),
    ).toBe("visible");
  });

  it("isAvailableFor maps each kind onto its flag", () => {
    const s = SharingSetting.create({
      visibility: "visible",
      forTrade: true,
      forSale: false,
      forLend: true,
    });
    expect(s.isAvailableFor("trade")).toBe(true);
    expect(s.isAvailableFor("sale")).toBe(false);
    expect(s.isAvailableFor("lend")).toBe(true);
    expect(s.isAvailableForAnyExchange()).toBe(true);
  });

  it("a private copy offered for exchange is still publicly visible (offer implies visibility)", () => {
    const s = SharingSetting.create({ visibility: "private", forSale: true });
    expect(s.isPubliclyVisible()).toBe(true);
  });

  it("a visible, non-exchange copy is publicly visible but not transactable", () => {
    const s = SharingSetting.create({ visibility: "visible" });
    expect(s.isPubliclyVisible()).toBe(true);
    expect(s.isAvailableForAnyExchange()).toBe(false);
  });
});
