import { createTranslator } from "use-intl";
import { describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import source from "../../../locales/source.json";

// The member card's name-qualified action labels and rating description must exist in all
// three catalogs (source.json is the dev fallback and mirrors en) and be valid ICU.
const catalogs = { en, nl, source } as const;

const format = (messages: typeof en, locale: string) => {
  const t = createTranslator({ locale, messages });
  return {
    followName: t("follow.followName", { name: "Mara" }),
    requestToFollowName: t("follow.requestToFollowName", { name: "Mara" }),
    unfollowName: t("follow.unfollowName", { name: "Mara" }),
    requestedName: t("follow.requestedName", { name: "Mara" }),
    messageName: t("messages.messageName", { name: "Mara" }),
    ratingSrOne: t("people.ratingSr", { rating: "4,8", count: 1 }),
    ratingSrMany: t("people.ratingSr", { rating: "4,8", count: 12 }),
  };
};

describe("member card locale keys", () => {
  it.each(Object.entries(catalogs))(
    "%s has every key, interpolating the name and count",
    (name, messages) => {
      const out = format(messages, name === "nl" ? "nl" : "en");
      for (const [key, value] of Object.entries(out)) {
        expect(value, key).not.toContain("follow.");
        expect(value, key).not.toContain("messages.");
        expect(value, key).not.toContain("people.");
      }
      expect(out.unfollowName).toContain("Mara");
      expect(out.messageName).toContain("Mara");
      expect(out.ratingSrOne).toContain("1 review");
      expect(out.ratingSrMany).toContain("12 reviews");
      expect(out.ratingSrMany).toContain("4,8");
    },
  );

  it("source.json mirrors en.json for the new keys", () => {
    expect(format(source, "en")).toEqual(format(en, "en"));
  });

  it("nl is translated", () => {
    expect(format(nl, "nl").unfollowName).toBe("Mara ontvolgen");
    expect(format(nl, "nl").messageName).toBe("Bericht sturen aan Mara");
  });
});
