import { ConvexError } from "convex/values";
import { createTranslator } from "use-intl";
import { describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { addErrorKey } from "./add-error";

const fail = (code: string) => new ConvexError({ code, message: "x" });

describe("addErrorKey", () => {
  it("explains the daily copy budget", () => {
    expect(addErrorKey(fail("RateLimited"))).toBe("rateLimited");
    // convex-test and some transports hand the data over JSON-encoded.
    expect(
      addErrorKey(new ConvexError(JSON.stringify({ code: "RateLimited" }))),
    ).toBe("rateLimited");
  });

  it("keeps the generic message for every other failure", () => {
    expect(addErrorKey(fail("PuzzleNotAcquirable"))).toBe("addFailed");
    expect(addErrorKey(new Error("network"))).toBe("addFailed");
  });

  it("has both messages in en and nl", () => {
    for (const [locale, messages] of [
      ["en", en],
      ["nl", nl],
    ] as const) {
      const t = createTranslator({
        locale,
        messages,
        namespace: "cataloguePicker",
      });
      expect(t.has("rateLimited")).toBe(true);
      expect(t.has("addFailed")).toBe(true);
      // The single add form (my-puzzles/add/new) shows the same refusal.
      expect(
        createTranslator({ locale, messages, namespace: "puzzles" }).has(
          "addRateLimited",
        ),
      ).toBe(true);
    }
    expect(
      createTranslator({
        locale: "nl",
        messages: nl,
        namespace: "cataloguePicker",
      })("rateLimited"),
    ).toBe(
      "Je hebt vandaag al veel puzzels toegevoegd. Probeer het morgen opnieuw.",
    );
  });
});
