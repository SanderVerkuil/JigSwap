import { describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import source from "../../../locales/source.json";
import {
  ACTIVITY_KINDS,
  ACTIVITY_META,
  isKnownActivityKind,
} from "./activity-feed-meta";

type LocaleShape = {
  activity: Record<string, unknown>;
  dashboard: { pulse: { latest: Record<string, unknown> } };
};
const locales: [string, LocaleShape][] = [
  ["en", en as unknown as LocaleShape],
  ["nl", nl as unknown as LocaleShape],
  ["source", source as unknown as LocaleShape],
];

describe("ACTIVITY_META", () => {
  it("covers every activity kind", () => {
    for (const kind of ACTIVITY_KINDS) {
      expect(ACTIVITY_META[kind], `META missing kind "${kind}"`).toBeDefined();
    }
  });

  it("has activity.<kind>.{you,other} and dashboard.pulse.latest.<kind> in every locale", () => {
    for (const [name, locale] of locales) {
      for (const kind of ACTIVITY_KINDS) {
        const entry = locale.activity[kind] as
          { you?: string; other?: string } | undefined;
        expect(entry?.you, `${name}: activity.${kind}.you`).toBeTruthy();
        expect(entry?.other, `${name}: activity.${kind}.other`).toBeTruthy();
        expect(
          locale.dashboard.pulse.latest[kind],
          `${name}: dashboard.pulse.latest.${kind}`,
        ).toBeTruthy();
      }
    }
  });

  it("has activity.<kind>.{youTitled,otherTitled} for every titled kind in every locale", () => {
    for (const [name, locale] of locales) {
      for (const kind of ACTIVITY_KINDS) {
        if (!ACTIVITY_META[kind].titled) continue;
        const entry = locale.activity[kind] as
          { youTitled?: string; otherTitled?: string } | undefined;
        expect(entry?.youTitled, `${name}: activity.${kind}.youTitled`).toMatch(
          /<puzzle>\{title\}<\/puzzle>/,
        );
        expect(
          entry?.otherTitled,
          `${name}: activity.${kind}.otherTitled`,
        ).toMatch(/<puzzle>\{title\}<\/puzzle>/);
      }
    }
  });

  it("guards unknown kinds (deploy-order safety: renderers skip, never crash)", () => {
    expect(isKnownActivityKind("started")).toBe(true);
    expect(isKnownActivityKind("some-future-kind")).toBe(false);
  });
});
