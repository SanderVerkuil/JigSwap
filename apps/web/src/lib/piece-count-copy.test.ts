import { createTranslator } from "use-intl";
import { describe, expect, it } from "vitest";
import en from "../../locales/en.json";
import nl from "../../locales/nl.json";

// Every message that puts a number in front of "pieces" agrees with it and groups it in the
// app locale: Dutch says "1 stukje" / "1.000 stukjes", never "stukken" (UX-65, UX-63).
const COUNTED = [
  "tradeRequest.pieces",
  "copyConversation.pieces",
  "admin.moderation.pieces",
  "admin.puzzles.pieces",
  "members.profile.piecesValue",
  "lending.pieceCount",
  "profile.completions.pieces",
  "profile.currentlySolving.pieces",
  "dashboard.solvingNow.pieces",
] as const;

const translators = {
  en: createTranslator({ locale: "en", messages: en }),
  nl: createTranslator({ locale: "nl", messages: nl }),
};

describe.each([
  ["en", "piece", "pieces", "1,000"],
  ["nl", "stukje", "stukjes", "1.000"],
] as const)("piece counts in %s", (locale, singular, plural, thousand) => {
  const t = translators[locale];

  it.each(COUNTED)("%s agrees with and groups its count", (key) => {
    expect(t(key, { count: 1 })).toBe(`1 ${singular}`);
    expect(t(key, { count: 1000 })).toBe(`${thousand} ${plural}`);
  });

  // The bare word follows a separately formatted number (format.number).
  it("puzzles.pieces is the bare word, in the right number", () => {
    expect(t("puzzles.pieces", { count: 1 })).toBe(singular);
    expect(t("puzzles.pieces", { count: 1000 })).toBe(plural);
  });
});
