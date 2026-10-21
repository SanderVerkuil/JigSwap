import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";
import {
  allowedProposeTypes,
  canRequestTrade,
  parsePriceCents,
  proposeErrorKey,
} from "./request-trade";

const none = { forTrade: false, forSale: false, forLend: false };

describe("allowedProposeTypes", () => {
  it("maps each availability flag to its propose type, in a stable order", () => {
    expect(
      allowedProposeTypes({ forTrade: true, forSale: true, forLend: true }),
    ).toEqual(["trade", "sale", "loan"]);
    expect(allowedProposeTypes({ ...none, forLend: true })).toEqual(["loan"]);
    expect(allowedProposeTypes({ ...none, forSale: true })).toEqual(["sale"]);
  });

  it("is empty when the copy is not available", () => {
    expect(allowedProposeTypes(none)).toEqual([]);
  });
});

describe("canRequestTrade", () => {
  const copy = { ownerId: "owner", availability: { ...none, forTrade: true } };

  it("allows another signed-in member on an available copy", () => {
    expect(canRequestTrade(copy, "viewer")).toBe(true);
  });

  it("is false for the owner", () => {
    expect(canRequestTrade(copy, "owner")).toBe(false);
  });

  it("allows a copy whose anonymous owner carries no id", () => {
    expect(canRequestTrade({ availability: copy.availability }, "viewer")).toBe(
      true,
    );
  });

  it("is false when the copy isn't available", () => {
    expect(canRequestTrade({ ...copy, availability: none }, "viewer")).toBe(
      false,
    );
  });

  it("is false before the viewer is known", () => {
    expect(canRequestTrade(copy, undefined)).toBe(false);
  });

  it("is false when the server says the viewer may not request it", () => {
    expect(
      canRequestTrade({ ...copy, viewerMayRequest: false }, "viewer"),
    ).toBe(false);
    expect(canRequestTrade({ ...copy, viewerMayRequest: true }, "viewer")).toBe(
      true,
    );
  });
});

describe("proposeErrorKey", () => {
  const err = (code: string) => new ConvexError({ code, message: "x" });

  it.each([
    ["CopyNotAvailable", "notAvailable"],
    ["CopyNotFound", "notFound"],
    ["CopyNotReachable", "notReachable"],
    ["NotPermittedInCircle", "viewOnly"],
    ["OfferedCopyNotOwned", "offeredNotOwned"],
    ["RecipientNotOwner", "notFound"],
    ["DuplicateProposal", "duplicate"],
    ["SelfExchange", "ownCopy"],
    ["MissingTerms", "missingTerms"],
  ])("maps %s to %s", (code, key) => {
    expect(proposeErrorKey(err(code))).toBe(key);
  });

  it("parses the JSON-string data shape too", () => {
    const e = new ConvexError(
      JSON.stringify({ code: "DuplicateProposal", message: "x" }),
    );
    expect(proposeErrorKey(e)).toBe("duplicate");
  });

  it("falls back to generic for unknown codes and non-Convex errors", () => {
    expect(proposeErrorKey(err("Nope"))).toBe("generic");
    expect(proposeErrorKey(new ConvexError("Unauthenticated"))).toBe("generic");
    expect(proposeErrorKey(new Error("boom"))).toBe("generic");
  });
});

describe("parsePriceCents", () => {
  it("parses euro amounts with dot or comma into cents", () => {
    expect(parsePriceCents("12")).toBe(1200);
    expect(parsePriceCents("12.5")).toBe(1250);
    expect(parsePriceCents("12,99")).toBe(1299);
    expect(parsePriceCents(" 0.01 ")).toBe(1);
  });

  it("rejects empty, non-positive, and malformed input", () => {
    expect(parsePriceCents("")).toBeUndefined();
    expect(parsePriceCents("0")).toBeUndefined();
    expect(parsePriceCents("-3")).toBeUndefined();
    expect(parsePriceCents("abc")).toBeUndefined();
    expect(parsePriceCents("1.234")).toBeUndefined();
  });
});
