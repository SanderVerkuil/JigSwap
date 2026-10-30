import { convexErrorCode as sharedConvexErrorCode } from "@/lib/convex-error-code";
import { ConvexError } from "convex/values";
import { ArrowLeftRight, Package, Tag } from "lucide-react";
import { describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import {
  allowedProposeTypes,
  canRequestTrade,
  convexErrorCode,
  parsePriceCents,
  proposeErrorKey,
  REQUEST_ACTION_ICONS,
  requestActionKey,
} from "./request-trade";

const none = { forTrade: false, forSale: false, forLend: false };

describe("requestActionKey", () => {
  it("names the one exchange a copy is offered for", () => {
    expect(requestActionKey({ ...none, forLend: true })).toBe("borrow");
    expect(requestActionKey({ ...none, forTrade: true })).toBe("swap");
    expect(requestActionKey({ ...none, forSale: true })).toBe("buy");
  });

  it("asks generically when the copy is offered for more than one", () => {
    expect(requestActionKey({ ...none, forTrade: true, forLend: true })).toBe(
      "mixed",
    );
    expect(requestActionKey({ ...none, forSale: true, forLend: true })).toBe(
      "mixed",
    );
    expect(
      requestActionKey({ forTrade: true, forSale: true, forLend: true }),
    ).toBe("mixed");
  });

  it.each([
    [{ ...none, forLend: true }, "Ask to borrow", "Vragen om te lenen"],
    [{ ...none, forTrade: true }, "Request swap", "Ruil aanvragen"],
    [{ ...none, forSale: true }, "Ask to buy", "Vragen om te kopen"],
    [{ ...none, forTrade: true, forLend: true }, "Request…", "Aanvragen…"],
  ])(
    "labels the button in EN and NL (%o)",
    (availability, enLabel, nlLabel) => {
      const key = requestActionKey(availability);
      expect(en.tradeRequest.cta[key]).toBe(enLabel);
      expect(nl.tradeRequest.cta[key]).toBe(nlLabel);
    },
  );

  it("uses the exchange kind's icon, the swap arrows for a mixed request", () => {
    expect(REQUEST_ACTION_ICONS.borrow).toBe(Package);
    expect(REQUEST_ACTION_ICONS.swap).toBe(ArrowLeftRight);
    expect(REQUEST_ACTION_ICONS.buy).toBe(Tag);
    expect(REQUEST_ACTION_ICONS.mixed).toBe(ArrowLeftRight);
  });
});

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
    ["CopyReserved", "offeredNotOwned"],
    ["RecipientNotOwner", "notFound"],
    ["DuplicateProposal", "duplicate"],
    ["SelfExchange", "ownCopy"],
    ["MissingTerms", "missingTerms"],
    ["RateLimited", "rateLimited"],
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

describe("convexErrorCode re-export", () => {
  it("is the shared lib helper, so imports from this module keep working", () => {
    expect(convexErrorCode).toBe(sharedConvexErrorCode);
    expect(convexErrorCode(new ConvexError({ code: "CopyNotFound" }))).toBe(
      "CopyNotFound",
    );
  });
});
