import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import source from "../../../locales/source.json";
import { exchangeErrorKey, loanErrorKey } from "./exchange-error";

const refusal = (code: string) => new ConvexError({ code, message: "x" });

// Resolve a dotted key inside one namespace of a catalog.
const lookup = (catalog: object, path: string): unknown =>
  path
    .split(".")
    .reduce<unknown>(
      (node, part) =>
        typeof node === "object" && node !== null
          ? (node as Record<string, unknown>)[part]
          : undefined,
      catalog,
    );

const EXCHANGE_CODES = [
  "IllegalTransition",
  "WrongParty",
  "ExchangeNotFound",
  "NotPermittedInCircle",
  "NotConnected",
  "CopyNotAvailable",
];
// The refusals that share or name a message rather than having one per code.
const SETTLEMENT_REFUSALS = [
  ["CopyReserved", "errors.copyReserved"],
  ["RecipientNotOwner", "errors.copyChangedHands"],
  ["OfferedCopyNotOwned", "errors.copyChangedHands"],
  ["CopyNotFound", "errors.copyChangedHands"],
];
const LOAN_CODES = ["LoanNotFound", "LoanNotOpen", "NotBorrower", "NotLender"];

describe("exchangeErrorKey", () => {
  it("maps each lifecycle refusal to its own message key", () => {
    for (const code of EXCHANGE_CODES) {
      expect(exchangeErrorKey(refusal(code))).toBe(`errors.${code}`);
    }
  });

  it.each(SETTLEMENT_REFUSALS)(
    "explains a settlement refusal: %s to %s",
    (code, key) => {
      expect(exchangeErrorKey(refusal(code))).toBe(key);
    },
  );

  it("reads codes that arrive JSON-encoded", () => {
    expect(
      exchangeErrorKey(
        new ConvexError(JSON.stringify({ code: "WrongParty", message: "x" })),
      ),
    ).toBe("errors.WrongParty");
    expect(
      exchangeErrorKey(
        new ConvexError(JSON.stringify({ code: "CopyReserved", message: "x" })),
      ),
    ).toBe("errors.copyReserved");
  });

  it("falls back to the generic key for unknown codes, inherited names, loan codes and plain errors", () => {
    expect(exchangeErrorKey(refusal("Weird"))).toBe("errors.generic");
    expect(exchangeErrorKey(refusal("constructor"))).toBe("errors.generic");
    expect(exchangeErrorKey(refusal("LoanNotOpen"))).toBe("errors.generic");
    expect(exchangeErrorKey(new ConvexError("Unauthenticated"))).toBe(
      "errors.generic",
    );
    expect(exchangeErrorKey(new Error("offline"))).toBe("errors.generic");
  });
});

describe("loanErrorKey", () => {
  it("maps each loan refusal to its own message key", () => {
    for (const code of LOAN_CODES) {
      expect(loanErrorKey(refusal(code))).toBe(`errors.${code}`);
    }
  });

  it("falls back to the generic key for anything else", () => {
    expect(loanErrorKey(refusal("WrongParty"))).toBe("errors.generic");
    expect(loanErrorKey(refusal("constructor"))).toBe("errors.generic");
    expect(loanErrorKey(new Error("offline"))).toBe("errors.generic");
  });
});

describe("error messages", () => {
  it("exist in every catalog for every key the mappers can return", () => {
    for (const catalog of [en, nl, source]) {
      for (const key of [
        ...EXCHANGE_CODES.map((code) => `errors.${code}`),
        ...SETTLEMENT_REFUSALS.map(([, key]) => key),
        "errors.generic",
      ]) {
        expect(typeof lookup(catalog.trades, key), `trades.${key}`).toBe(
          "string",
        );
      }
      for (const code of [...LOAN_CODES, "generic"]) {
        expect(
          typeof lookup(catalog.lending, `errors.${code}`),
          `lending.errors.${code}`,
        ).toBe("string");
      }
    }
  });
});
