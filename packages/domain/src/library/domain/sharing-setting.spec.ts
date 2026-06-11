import { describe, expect, it } from "vitest";
import { SharingSetting } from "./sharing-setting";

describe("SharingSetting", () => {
  it("private() is private and offered for nothing", () => {
    const s = SharingSetting.private();
    expect(s.visibility).toBe("private");
    expect(s.isAvailableForAnyExchange()).toBe(false);
    expect(s.isPubliclyVisible()).toBe(false);
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
