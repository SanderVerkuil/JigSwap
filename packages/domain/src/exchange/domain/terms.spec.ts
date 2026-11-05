import { describe, expect, it } from "vitest";
import { toCopyId } from "../../shared-kernel";
import { CopyId } from "./ids";
import { MAX_MONEY_CENTS, Money, validateTerms } from "./terms";

const copy = (s: string): CopyId => toCopyId(s);
const NOW = new Date("2026-06-01T12:00:00Z");

describe("Money", () => {
  it("accepts a positive integer amount and normalises currency", () => {
    const result = Money.create(1599, "eur");
    expect(result.isOk).toBe(true);
    if (result.isOk) {
      expect(result.value.amountCents).toBe(1599);
      expect(result.value.currency).toBe("EUR");
    }
  });

  // Zero is the boundary distinguishing `<= 0` from `< 0`; fractional fails the integer half.
  it.each([0, -100, 12.5])(
    "rejects non-positive or fractional amount %s",
    (amount) => {
      const result = Money.create(amount, "EUR");
      expect(result.isErr).toBe(true);
      if (result.isErr) {
        expect(result.error.code).toBe("MissingTerms");
        expect(result.error.message).toBe(
          "Invalid terms for sale: price must be a positive integer (cents)",
        );
      }
    },
  );

  // 1e300 is an integer too, and the other party is shown it.
  it.each([MAX_MONEY_CENTS + 1, 1e300, Number.MAX_VALUE])(
    "rejects %p cents as more than any puzzle can cost",
    (amount) => {
      const result = Money.create(amount, "EUR");
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("MissingTerms");
    },
  );

  it("accepts the highest price", () => {
    expect(Money.create(MAX_MONEY_CENTS, "EUR").isOk).toBe(true);
  });

  it("rehydrates a stored amount as it is, whatever the bound", () => {
    expect(Money.fromState(1e300, "EUR").amountCents).toBe(1e300);
  });

  it.each(["EU", "EURO", ""])(
    "rejects a currency that is not a 3-letter code (%j)",
    (currency) => {
      const result = Money.create(100, currency);
      expect(result.isErr).toBe(true);
      if (result.isErr) {
        expect(result.error.message).toBe(
          "Invalid terms for sale: currency must be a 3-letter ISO code",
        );
      }
    },
  );
});

describe("validateTerms", () => {
  it("swap requires an offered copy", () => {
    const missing = validateTerms({ kind: "swap" }, NOW);
    expect(missing.isErr).toBe(true);
    if (missing.isErr) {
      expect(missing.error.message).toBe(
        "Invalid terms for swap: an offered copy is required",
      );
    }
    const ok = validateTerms({ kind: "swap", offeredCopyId: copy("c1") }, NOW);
    expect(ok.isOk).toBe(true);
    if (ok.isOk && ok.value.kind === "swap") {
      expect(ok.value.offeredCopyId).toBe(copy("c1"));
    }
  });

  it("sale requires a price", () => {
    const missing = validateTerms({ kind: "sale" }, NOW);
    expect(missing.isErr).toBe(true);
    if (missing.isErr) {
      expect(missing.error.message).toBe(
        "Invalid terms for sale: a price is required",
      );
    }
    const price = Money.create(500, "EUR");
    if (!price.isOk) throw new Error("setup");
    const ok = validateTerms({ kind: "sale", price: price.value }, NOW);
    expect(ok.isOk).toBe(true);
    if (ok.isOk && ok.value.kind === "sale") {
      expect(ok.value.price).toBe(price.value);
    }
  });

  it("lend is open-ended: returnDate is optional and only advisory", () => {
    const openEnded = validateTerms({ kind: "lend" }, NOW);
    expect(openEnded.isOk).toBe(true);
    if (openEnded.isOk && openEnded.value.kind === "lend") {
      expect(openEnded.value.returnDate).toBeUndefined();
    }
    const date = new Date("2026-07-01");
    const withDate = validateTerms({ kind: "lend", returnDate: date }, NOW);
    expect(withDate.isOk).toBe(true);
    if (withDate.isOk && withDate.value.kind === "lend") {
      expect(withDate.value.returnDate).toBe(date);
    }
  });

  it.each([
    ["not a date", new Date(Number.NaN)],
    ["outside any calendar", new Date(1e30)],
    ["long gone", new Date("2026-05-30T12:00:00Z")],
    ["more than ten years ahead", new Date("2036-06-02T12:00:00Z")],
  ])("refuses a return date that is %s", (_label, returnDate) => {
    const result = validateTerms({ kind: "lend", returnDate }, NOW);
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("MissingTerms");
  });

  it("takes a return date from today up to ten years ahead", () => {
    for (const returnDate of [
      new Date("2026-05-31T23:00:00Z"),
      new Date("2036-05-28T12:00:00Z"),
    ]) {
      expect(validateTerms({ kind: "lend", returnDate }, NOW).isOk).toBe(true);
    }
  });

  it("missing-terms errors carry the MissingTerms code", () => {
    const result = validateTerms({ kind: "sale" }, NOW);
    if (result.isErr) expect(result.error.code).toBe("MissingTerms");
    else throw new Error("expected err");
  });
});
