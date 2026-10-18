import { ConvexError } from "convex/values";
import { createTranslator } from "use-intl";
import { describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { isInvalidCircleName, MAX_CIRCLE_NAME_LENGTH } from "./circle-name";

const fail = (code: string) => new ConvexError({ code, message: "x" });

describe("circle name", () => {
  it("caps a new name at 100 characters, like the domain", () => {
    expect(MAX_CIRCLE_NAME_LENGTH).toBe(100);
  });

  it("recognises only the InvalidCircleName refusal", () => {
    expect(isInvalidCircleName(fail("InvalidCircleName"))).toBe(true);
    expect(isInvalidCircleName(fail("CircleFull"))).toBe(false);
    expect(isInvalidCircleName(new ConvexError("plain"))).toBe(false);
    expect(isInvalidCircleName(new Error("InvalidCircleName"))).toBe(false);
  });

  it("has the invalid-name message and counter in en and nl", () => {
    for (const [locale, messages, invalid] of [
      ["en", en, "A circle name must be 1 to 100 characters."],
      ["nl", nl, "Een kringnaam moet 1 tot 100 tekens lang zijn."],
    ] as const) {
      const t = createTranslator({ locale, messages, namespace: "circles" });
      expect(t("manage.nameInvalid")).toBe(invalid);
      expect(
        t("manage.nameCounter", { count: 12, max: MAX_CIRCLE_NAME_LENGTH }),
      ).toBe("12/100");
    }
  });
});
