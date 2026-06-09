import { describe, expect, it } from "vitest";
import { EXCHANGE_KINDS } from "./exchange-kind";

describe("EXCHANGE_KINDS", () => {
  it("enumerates exactly the three supported kinds in their canonical order", () => {
    expect(EXCHANGE_KINDS).toEqual(["swap", "sale", "lend"]);
  });

  it("contains each kind exactly once (no duplicates, no extras)", () => {
    expect([...EXCHANGE_KINDS].sort()).toEqual(["lend", "sale", "swap"]);
    expect(EXCHANGE_KINDS).toHaveLength(3);
  });
});
