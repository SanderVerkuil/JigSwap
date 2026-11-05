import { createTranslator } from "use-intl";
import { describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import source from "../../../locales/source.json";
import { formatCopyTenure } from "./copy-tenure";

// The copy page's "In your library" line says how long the owner has had the copy in words, not
// as "<1m" or "1y 5m", which read as minutes or metres.

const MONTH = 1000 * 60 * 60 * 24 * 30.4375;
const NOW = Date.UTC(2026, 9, 30);
const ago = (months: number) => NOW - months * MONTH;

const tenureIn = (messages: typeof en, locale: string) => {
  const t = createTranslator({ locale, messages, namespace: "copyInstance" });
  return (months: number) => formatCopyTenure(ago(months), NOW, t);
};

describe("copy tenure", () => {
  it("spells out years and months in English", () => {
    const tenure = tenureIn(en, "en");
    expect(tenure(0.5)).toBe("Less than a month");
    expect(tenure(1)).toBe("1 month");
    expect(tenure(5)).toBe("5 months");
    expect(tenure(12)).toBe("1 year");
    expect(tenure(17)).toBe("1 year 5 months");
    expect(tenure(25)).toBe("2 years 1 month");
  });

  it("spells out years and months in Dutch", () => {
    const tenure = tenureIn(nl, "nl");
    expect(tenure(0.5)).toBe("Minder dan een maand");
    expect(tenure(1)).toBe("1 maand");
    expect(tenure(17)).toBe("1 jaar 5 maanden");
    expect(tenure(24)).toBe("2 jaar");
  });

  it("source.json words it as en.json does", () => {
    const fromSource = tenureIn(source, "en");
    const fromEn = tenureIn(en, "en");
    for (const months of [0.5, 1, 5, 12, 17, 25]) {
      expect(fromSource(months)).toBe(fromEn(months));
    }
  });
});
