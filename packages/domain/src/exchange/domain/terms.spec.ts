import { describe, expect, it } from "vitest";
import { toCopyId } from "../../shared-kernel";
import { CopyId } from "./ids";
import { Money, validateTerms } from "./terms";

const copy = (s: string): CopyId => toCopyId(s);

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
    const missing = validateTerms({ kind: "swap" });
    expect(missing.isErr).toBe(true);
    if (missing.isErr) {
      expect(missing.error.message).toBe(
        "Invalid terms for swap: an offered copy is required",
      );
    }
    const ok = validateTerms({ kind: "swap", offeredCopyId: copy("c1") });
    expect(ok.isOk).toBe(true);
    if (ok.isOk && ok.value.kind === "swap") {
      expect(ok.value.offeredCopyId).toBe(copy("c1"));
    }
  });

  it("sale requires a price", () => {
    const missing = validateTerms({ kind: "sale" });
    expect(missing.isErr).toBe(true);
    if (missing.isErr) {
      expect(missing.error.message).toBe(
        "Invalid terms for sale: a price is required",
      );
    }
    const price = Money.create(500, "EUR");
    if (!price.isOk) throw new Error("setup");
    const ok = validateTerms({ kind: "sale", price: price.value });
    expect(ok.isOk).toBe(true);
    if (ok.isOk && ok.value.kind === "sale") {
      expect(ok.value.price).toBe(price.value);
    }
  });

  it("lend is open-ended: returnDate is optional and only advisory", () => {
    const openEnded = validateTerms({ kind: "lend" });
    expect(openEnded.isOk).toBe(true);
    if (openEnded.isOk && openEnded.value.kind === "lend") {
      expect(openEnded.value.returnDate).toBeUndefined();
    }
    const date = new Date("2026-07-01");
    const withDate = validateTerms({ kind: "lend", returnDate: date });
    expect(withDate.isOk).toBe(true);
    if (withDate.isOk && withDate.value.kind === "lend") {
      expect(withDate.value.returnDate).toBe(date);
    }
  });

  it("missing-terms errors carry the MissingTerms code", () => {
    const result = validateTerms({ kind: "sale" });
    if (result.isErr) expect(result.error.code).toBe("MissingTerms");
    else throw new Error("expected err");
  });
});
