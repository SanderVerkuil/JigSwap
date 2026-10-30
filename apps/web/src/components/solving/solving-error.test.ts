import { ConvexError } from "convex/values";
import { createTranslator } from "use-intl";
import { describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { solveSaveErrorKey } from "./solving-error";

const fail = (code: string) => new ConvexError({ code, message: "x" });

// Every form that logs or starts a solve, by its i18n namespace.
const SOLVE_FORMS = [
  "solving.logSolve",
  "solving.startSolve",
  "quickStart.solves",
] as const;

describe("solveSaveErrorKey", () => {
  it("explains the daily solve budget", () => {
    expect(solveSaveErrorKey(fail("RateLimited"))).toBe("rateLimited");
  });

  it("keeps the generic save error for every other failure", () => {
    expect(solveSaveErrorKey(fail("InvalidTimeRange"))).toBe("saveError");
    expect(solveSaveErrorKey(new ConvexError("Copy not found"))).toBe(
      "saveError",
    );
    expect(solveSaveErrorKey(new Error("network"))).toBe("saveError");
  });

  it("has both messages in every solve form, in en and nl", () => {
    for (const [locale, messages] of [
      ["en", en],
      ["nl", nl],
    ] as const) {
      for (const namespace of SOLVE_FORMS) {
        const t = createTranslator({ locale, messages, namespace });
        expect(t.has("rateLimited")).toBe(true);
        expect(t.has("saveError")).toBe(true);
      }
    }
    expect(
      createTranslator({
        locale: "nl",
        messages: nl,
        namespace: "solving.logSolve",
      })("rateLimited"),
    ).toBe(
      "Je hebt vandaag al veel voltooiingen vastgelegd. Probeer het morgen opnieuw.",
    );
  });
});
