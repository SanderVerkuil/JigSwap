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
  returnByDate,
  tomorrowInputValue,
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

  it("takes the highest price the server does, and nothing above it", () => {
    expect(parsePriceCents("1000000")).toBe(100_000_000);
    expect(parsePriceCents("1000000.01")).toBeUndefined();
    expect(parsePriceCents("9".repeat(400))).toBeUndefined();
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

describe("returnByDate", () => {
  // 30 Oct 2026, mid-afternoon local time. Dates are built from local parts so the
  // expectations hold in any time zone the tests run in.
  const now = new Date(2026, 9, 30, 15, 30);
  const midday = (year: number, month: number, day: number) =>
    new Date(year, month, day, 12).getTime();

  it("sends no date unless the requester picks one", () => {
    expect(returnByDate("none", now)).toBeUndefined();
  });

  it("counts the presets in calendar days from today, at local midday", () => {
    expect(returnByDate("2w", now)).toBe(midday(2026, 10, 13));
    expect(returnByDate("3w", now)).toBe(midday(2026, 10, 20));
    expect(returnByDate("1m", now)).toBe(midday(2026, 10, 30));
  });

  it("keeps whole days across a daylight-saving change", () => {
    // Europe's clocks go back on 25 Oct 2026.
    expect(returnByDate("2w", new Date(2026, 9, 20, 23, 30))).toBe(
      midday(2026, 10, 3),
    );
  });

  it("ends a month on the last day of a shorter month", () => {
    expect(returnByDate("1m", new Date(2027, 0, 31, 9))).toBe(
      midday(2027, 1, 28),
    );
    expect(returnByDate("1m", new Date(2026, 11, 15, 9))).toBe(
      midday(2027, 0, 15),
    );
  });

  it("takes a picked date from tomorrow on", () => {
    expect(returnByDate("custom", now, "2026-10-31")).toBe(midday(2026, 9, 31));
    expect(returnByDate("custom", now, "2027-01-15")).toBe(midday(2027, 0, 15));
  });

  it("refuses an empty, past, today's or impossible picked date", () => {
    for (const value of [
      "",
      "2026-10-30",
      "2026-10-01",
      "2027-02-30",
      "2026-13-01",
      "31-10-2026",
    ]) {
      expect(returnByDate("custom", now, value)).toBeUndefined();
    }
  });
});

describe("tomorrowInputValue", () => {
  it("is the next local calendar day as a date input value", () => {
    expect(tomorrowInputValue(new Date(2026, 9, 30, 15))).toBe("2026-10-31");
    expect(tomorrowInputValue(new Date(2026, 11, 31, 23, 59))).toBe(
      "2027-01-01",
    );
  });
});
