import { describe, expect, it } from "vitest";
import { mayExchangeVia } from "./exchange-route";

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
