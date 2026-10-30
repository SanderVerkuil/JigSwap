import { ConvexError } from "convex/values";
import { createTranslator } from "use-intl";
import { describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import source from "../../../locales/source.json";
import { exchangeErrorKey } from "./exchange-error";

const fail = (code: string) => new ConvexError({ code, message: "x" });

describe("exchangeErrorKey", () => {
  it.each([
    ["NotPermittedInCircle", "acceptNotPermitted"],
    ["CopyReserved", "errors.copyReserved"],
    ["RecipientNotOwner", "errors.copyChangedHands"],
    ["OfferedCopyNotOwned", "errors.copyChangedHands"],
    ["CopyNotFound", "errors.copyChangedHands"],
  ])("maps %s to %s", (code, key) => {
    expect(exchangeErrorKey(fail(code))).toBe(key);
  });

  it("parses the JSON-string data shape too", () => {
    expect(
      exchangeErrorKey(
        new ConvexError(JSON.stringify({ code: "CopyReserved", message: "x" })),
      ),
    ).toBe("errors.copyReserved");
  });

  it("explains nothing else: unknown codes, inherited names and non-Convex errors", () => {
    expect(exchangeErrorKey(fail("InvalidTransition"))).toBeUndefined();
    expect(exchangeErrorKey(fail("constructor"))).toBeUndefined();
    expect(
      exchangeErrorKey(new ConvexError("Unauthenticated")),
    ).toBeUndefined();
    expect(exchangeErrorKey(new Error("boom"))).toBeUndefined();
  });

  it("has a message for every key it can return, in every locale file", () => {
    const keys = [
      "acceptNotPermitted",
      "errors.copyReserved",
      "errors.copyChangedHands",
    ];
    for (const [locale, messages] of [
      ["en", en],
      ["nl", nl],
      ["en", source],
    ] as const) {
      const t = createTranslator({ locale, messages, namespace: "trades" });
      for (const key of keys) {
        expect(t.has(key as never)).toBe(true);
      }
    }
  });
});
