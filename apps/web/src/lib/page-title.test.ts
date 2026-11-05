import { describe, expect, it, vi } from "vitest";
import en from "../../locales/en.json";
import nl from "../../locales/nl.json";
import type { Locale } from "./i18n";
import {
  defaultDocumentTitle,
  namedDocumentTitle,
  pageTitle,
} from "./page-title";

// The loaded catalogs, by locale: the title comes from the catalog of the locale in the root
// context, not from the context itself.
const catalogs: Partial<Record<Locale, unknown>> = { en, nl };

vi.mock("./i18n-catalog", () => ({
  messagesFor: (locale: Locale) => catalogs[locale],
}));

const context = (locale: Locale) => ({
  intl: { locale, timeZone: "Europe/Amsterdam", now: 0 },
});

describe("defaultDocumentTitle", () => {
  it("is the brand on a page that sets no title of its own", () => {
    const matches = [{ _notFound: undefined }, { _notFound: undefined }];
    expect(defaultDocumentTitle(context("en"), matches)).toBe("JigSwap");
  });

  it("says page not found when the router has no route for the URL, whichever layout renders the 404", () => {
    expect(defaultDocumentTitle(context("en"), [{ _notFound: true }])).toBe(
      "Page not found — JigSwap",
    );
    expect(
      defaultDocumentTitle(context("en"), [
        { _notFound: undefined },
        { _notFound: true },
      ]),
    ).toBe("Page not found — JigSwap");
  });

  it("speaks the visitor's language", () => {
    expect(defaultDocumentTitle(context("nl"), [{ _notFound: true }])).toBe(
      nl.marketing.titles.notFound,
    );
  });

  it("falls back to the brand without an intl payload", () => {
    expect(defaultDocumentTitle(undefined, [{ _notFound: true }])).toBe(
      "JigSwap",
    );
  });
});

describe("pageTitle", () => {
  it("reads the title from the catalog of the context's locale", () => {
    expect(pageTitle(context("en"), "createPuzzle")).toBe(
      en.titles.createPuzzle,
    );
    expect(pageTitle(context("nl"), "createPuzzle")).toBe(
      nl.titles.createPuzzle,
    );
  });

  it("falls back to the marketing titles, in the app language", () => {
    expect(pageTitle(context("nl"), "catalog")).toBe(
      nl.marketing.titles.catalog,
    );
    expect(pageTitle(context("en"), "catalog")).toBe(
      en.marketing.titles.catalog,
    );
  });

  it("falls back to JigSwap for an unknown key, a missing context or an unloaded catalog", () => {
    expect(pageTitle(context("en"), "nope")).toBe("JigSwap");
    expect(pageTitle(undefined, "catalog")).toBe("JigSwap");
    expect(pageTitle({}, "catalog")).toBe("JigSwap");
    delete catalogs.nl;
    expect(pageTitle(context("nl"), "catalog")).toBe("JigSwap");
    catalogs.nl = nl;
  });
});

describe("namedDocumentTitle", () => {
  it("has the same shape as the catalog's titles", () => {
    expect(namedDocumentTitle("My puzzles")).toBe(en.titles.myPuzzles);
  });
});

// Their routes used to borrow their parent's title, under a different h1.
describe("the suggestion pages' own titles", () => {
  it.each([
    ["mySuggestions", "My suggestions — JigSwap", "Mijn voorstellen — JigSwap"],
    [
      "suggestEdit",
      "Suggest an edit — JigSwap",
      "Wijziging voorstellen — JigSwap",
    ],
  ])("%s", (key, english, dutch) => {
    expect(pageTitle(context("en"), key)).toBe(english);
    expect(pageTitle(context("nl"), key)).toBe(dutch);
  });
});
