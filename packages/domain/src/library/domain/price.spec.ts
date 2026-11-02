import { describe, expect, it } from "vitest";
import { MAX_PRICE_CENTS, Price } from "./price";

describe("Price.create", () => {
  it("accepts a positive integer amount and upper-cases the currency", () => {
    const r = Price.create(1599, "usd");
    expect(r.isOk).toBe(true);
    if (r.isOk) {
      expect(r.value.amountCents).toBe(1599);
      expect(r.value.currency).toBe("USD");
    }
  });

  it("leaves an already-upper-case currency unchanged", () => {
    const r = Price.create(100, "EUR");
    expect(r.isOk).toBe(true);
    if (r.isOk) expect(r.value.currency).toBe("EUR");
  });

  // A price of 1e300 cents is an integer too, and other members are shown it.
  it.each([MAX_PRICE_CENTS + 1, 1e300, Number.MAX_VALUE])(
    "rejects %p cents as more than any puzzle can cost",
    (amount) => {
      const r = Price.create(amount, "EUR");
      expect(r.isErr).toBe(true);
      if (r.isErr) expect(r.error.code).toBe("InvalidPrice");
    },
  );

  it("accepts the highest price", () => {
    expect(Price.create(MAX_PRICE_CENTS, "EUR").isOk).toBe(true);
  });

  // Zero is the boundary that distinguishes `<= 0` from `< 0`: it must be rejected.
  it("rejects a zero amount as not strictly positive", () => {
    const r = Price.create(0, "EUR");
    expect(r.isErr).toBe(true);
    if (r.isErr) {
      expect(r.error.code).toBe("InvalidPrice");
      expect(r.error.message).toBe(
        "Invalid price: amount must be a positive integer (cents)",
      );
    }
  });

  it("rejects a negative amount", () => {
    const r = Price.create(-1, "EUR");
    expect(r.isErr).toBe(true);
    if (r.isErr) expect(r.error.code).toBe("InvalidPrice");
  });

  // A fractional but positive amount fails the integer check while passing the sign check,
  // proving both halves of the `&&`/`||` guard are independently required.
  it("rejects a fractional amount", () => {
    const r = Price.create(12.5, "EUR");
    expect(r.isErr).toBe(true);
    if (r.isErr) {
      expect(r.error.code).toBe("InvalidPrice");
      expect(r.error.message).toBe(
        "Invalid price: amount must be a positive integer (cents)",
      );
    }
  });

  it.each([
    ["too short", "EU"],
    ["too long", "EURO"],
    ["empty", ""],
  ])("rejects a currency that is %s", (_label, currency) => {
    const r = Price.create(500, currency);
    expect(r.isErr).toBe(true);
    if (r.isErr) {
      expect(r.error.code).toBe("InvalidPrice");
      expect(r.error.message).toBe(
        "Invalid price: currency must be a 3-letter ISO code",
      );
    }
  });
});

describe("Price.fromState", () => {
  it("rehydrates a persisted value verbatim, without re-validating or normalising", () => {
    // fromState trusts stored data: it must NOT upper-case or reject, even values create()
    // would reject — proving it is a pure rehydrator distinct from create().
    const p = Price.fromState(-7, "eur");
    expect(p.amountCents).toBe(-7);
    expect(p.currency).toBe("eur");
  });
});
