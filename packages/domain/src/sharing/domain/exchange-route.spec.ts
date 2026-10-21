import { describe, expect, it } from "vitest";
import { exchangeAllowedVia, mayExchangeVia } from "./exchange-route";

describe("mayExchangeVia", () => {
  it("refuses when there is no route", () => {
    expect(mayExchangeVia([])).toBe(false);
  });

  it("refuses a ViewOnly circle seat on its own", () => {
    expect(mayExchangeVia([{ kind: "circle", level: "ViewOnly" }])).toBe(false);
  });

  it("allows an Exchange or Admin circle seat", () => {
    expect(mayExchangeVia([{ kind: "circle", level: "Exchange" }])).toBe(true);
    expect(mayExchangeVia([{ kind: "circle", level: "Admin" }])).toBe(true);
  });

  it("allows when another circle grants Exchange", () => {
    expect(
      mayExchangeVia([
        { kind: "circle", level: "ViewOnly" },
        { kind: "circle", level: "Exchange" },
      ]),
    ).toBe(true);
  });

  it.each(["public", "household", "mutualFollow"] as const)(
    "a %s route allows despite a ViewOnly circle seat",
    (kind) => {
      expect(
        mayExchangeVia([{ kind: "circle", level: "ViewOnly" }, { kind }]),
      ).toBe(true);
    },
  );
});

describe("exchangeAllowedVia", () => {
  it("is null when nothing allows it", () => {
    expect(exchangeAllowedVia([])).toBeNull();
    expect(
      exchangeAllowedVia([{ kind: "circle", level: "ViewOnly" }]),
    ).toBeNull();
  });

  it("is circle when only Exchange or Admin seats allow it", () => {
    expect(
      exchangeAllowedVia([
        { kind: "circle", level: "ViewOnly" },
        { kind: "circle", level: "Admin" },
      ]),
    ).toBe("circle");
  });

  it.each(["public", "household", "mutualFollow"] as const)(
    "is direct when a %s route exists, circle seats or not",
    (kind) => {
      expect(exchangeAllowedVia([{ kind }])).toBe("direct");
      expect(
        exchangeAllowedVia([{ kind: "circle", level: "Exchange" }, { kind }]),
      ).toBe("direct");
    },
  );
});
