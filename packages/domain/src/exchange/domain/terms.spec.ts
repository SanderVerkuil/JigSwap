import { describe, expect, it } from "vitest";
import { toId } from "../../shared-kernel";
import { CopyId } from "./ids";
import { Money, validateTerms } from "./terms";

const copy = (s: string): CopyId => toId<"CopyId">(s);

describe("Money", () => {
  it("accepts a positive integer amount and normalises currency", () => {
    const result = Money.create(1599, "eur");
    expect(result.isOk).toBe(true);
    if (result.isOk) {
      expect(result.value.amountCents).toBe(1599);
      expect(result.value.currency).toBe("EUR");
    }
  });

  it.each([0, -100, 12.5])("rejects non-positive or fractional amount %s", (amount) => {
    const result = Money.create(amount, "EUR");
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("MissingTerms");
  });

  it("rejects a currency that is not a 3-letter code", () => {
    const result = Money.create(100, "EURO");
    expect(result.isErr).toBe(true);
  });
});

describe("validateTerms", () => {
  it("swap requires an offered copy", () => {
    expect(validateTerms({ kind: "swap" }).isErr).toBe(true);
    const ok = validateTerms({ kind: "swap", offeredCopyId: copy("c1") });
    expect(ok.isOk).toBe(true);
    if (ok.isOk && ok.value.kind === "swap") {
      expect(ok.value.offeredCopyId).toBe(copy("c1"));
    }
  });

  it("sale requires a price", () => {
    expect(validateTerms({ kind: "sale" }).isErr).toBe(true);
    const price = Money.create(500, "EUR");
    if (!price.isOk) throw new Error("setup");
    const ok = validateTerms({ kind: "sale", price: price.value });
    expect(ok.isOk).toBe(true);
  });

  it("lend requires a return date", () => {
    expect(validateTerms({ kind: "lend" }).isErr).toBe(true);
    const ok = validateTerms({ kind: "lend", returnDate: new Date("2026-07-01") });
    expect(ok.isOk).toBe(true);
  });

  it("missing-terms errors carry the MissingTerms code", () => {
    const result = validateTerms({ kind: "lend" });
    if (result.isErr) expect(result.error.code).toBe("MissingTerms");
    else throw new Error("expected err");
  });
});
