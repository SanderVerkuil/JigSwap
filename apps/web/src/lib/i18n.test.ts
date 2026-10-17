import { describe, expect, it } from "vitest";
import { defaultLocale, mergeMessages, negotiateLocale } from "./i18n";

describe("negotiateLocale", () => {
  it("returns null when there is no Accept-Language header", () => {
    expect(negotiateLocale(undefined)).toBeNull();
    expect(negotiateLocale(null)).toBeNull();
    expect(negotiateLocale("")).toBeNull();
  });

  it("picks the best supported locale", () => {
    expect(negotiateLocale("nl,en;q=0.8")).toBe("nl");
    expect(negotiateLocale("en-US,en;q=0.9")).toBe("en");
    expect(negotiateLocale("nl-NL")).toBe("nl");
  });

  it("ignores the wildcard '*' instead of throwing", () => {
    // Regression: Negotiator yields "*" for `Accept-Language: *`, and
    // Intl.getCanonicalLocales("*") throws RangeError, which used to blow up
    // match() (the Vercel SSR "Incorrect locale information provided" error).
    expect(() => negotiateLocale("*")).not.toThrow();
    expect(negotiateLocale("*")).toBeNull();
  });

  it("skips a leading wildcard and still negotiates the next supported tag", () => {
    expect(negotiateLocale("*, nl;q=0.9")).toBe("nl");
  });

  it("resolves to the default locale when no requested language is supported", () => {
    expect(negotiateLocale("fr-FR,de;q=0.7")).toBe(defaultLocale);
  });
});

describe("mergeMessages", () => {
  it("lets the overlay win per leaf and keeps base keys it lacks", () => {
    const base = {
      a: { title: "Hello", body: "Untranslated" },
      b: "Only in source",
    };
    const overlay = { a: { title: "Hallo" } };
    expect(mergeMessages(base, overlay)).toEqual({
      a: { title: "Hallo", body: "Untranslated" },
      b: "Only in source",
    });
  });

  it("replaces arrays and strings wholesale instead of merging them", () => {
    expect(
      mergeMessages({ list: ["a", "b"] } as never, { list: ["c"] } as never),
    ).toEqual({ list: ["c"] });
  });

  it("does not mutate its inputs", () => {
    const base = { a: { x: "1" } };
    mergeMessages(base, { a: { x: "2" } });
    expect(base).toEqual({ a: { x: "1" } });
  });
});
