import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../locales/en.json";
import nl from "../../locales/nl.json";
import { headMessage, seoHead } from "./seo-head";

const intl = (locale: "en" | "nl") => ({
  locale,
  messages: locale === "en" ? en : nl,
  timeZone: "Europe/Amsterdam",
  now: 0,
});

const matchFor = (locale: "en" | "nl" | null, pathname = "/about") => ({
  context: locale ? { intl: intl(locale) } : {},
  pathname,
});

// Flattens the head's meta list to { title, <name|property>: content } for readable asserts.
function tags(head: ReturnType<typeof seoHead>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of head.meta) {
    const tag = m as {
      title?: string;
      name?: string;
      property?: string;
      content?: string;
    };
    if (tag.title) out.title = tag.title;
    else out[tag.name ?? tag.property ?? ""] = tag.content ?? "";
  }
  return out;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("seoHead", () => {
  it("gives an English page its title, description and share tags", () => {
    const head = tags(seoHead(matchFor("en"), "about"));
    expect(head.title).toBe(en.marketing.titles.about);
    expect(head.description).toBe(en.marketing.meta.about);
    expect(head["og:title"]).toBe(en.marketing.titles.about);
    expect(head["og:description"]).toBe(en.marketing.meta.about);
    expect(head["og:type"]).toBe("website");
    expect(head["og:site_name"]).toBe("JigSwap");
    expect(head["og:locale"]).toBe("en_US");
    expect(head["twitter:card"]).toBe("summary");
  });

  it("speaks Dutch to a Dutch visitor", () => {
    const head = tags(seoHead(matchFor("nl"), "about"));
    expect(head.title).toBe(nl.marketing.titles.about);
    expect(head.description).toBe(nl.marketing.meta.about);
    expect(head["og:locale"]).toBe("nl_NL");
  });

  it("has a title and description for every public marketing page", () => {
    for (const messages of [en, nl]) {
      const locale = messages === en ? "en" : "nl";
      for (const key of [
        "home",
        "howItWorks",
        "features",
        "about",
        "contact",
        "privacy",
        "terms",
        "catalog",
        "docs",
      ]) {
        const head = tags(seoHead(matchFor(locale), key));
        expect(head.title, `${locale} ${key} title`).not.toBe("JigSwap");
        expect(head.description, `${locale} ${key} description`).toBeTruthy();
      }
    }
  });

  it("falls back to the brand name and no description for an unknown key", () => {
    const head = tags(seoHead(matchFor("en"), "nope"));
    expect(head.title).toBe("JigSwap");
    expect(head.description).toBeUndefined();
    expect(head["og:description"]).toBeUndefined();
  });

  it("falls back to the brand name when the head context has no intl payload", () => {
    const head = tags(seoHead(matchFor(null), "about"));
    expect(head.title).toBe("JigSwap");
    expect(head.description).toBeUndefined();
  });

  it("lets a route override the title, description and image", () => {
    const head = tags(
      seoHead(matchFor("en", "/catalog/abc"), "catalog", {
        title: "Café — JigSwap",
        description: "A café puzzle.",
        image: "https://cdn.example.test/cover.jpg",
      }),
    );
    expect(head.title).toBe("Café — JigSwap");
    expect(head["og:title"]).toBe("Café — JigSwap");
    expect(head.description).toBe("A café puzzle.");
    expect(head["og:image"]).toBe("https://cdn.example.test/cover.jpg");
  });

  it("emits no og:image or og:url while the site origin is unknown", () => {
    vi.stubEnv("VITE_SITE_ORIGIN", "");
    const head = tags(seoHead(matchFor("en"), "about"));
    expect(head["og:image"]).toBeUndefined();
    expect(head["og:url"]).toBeUndefined();
  });

  it("points og:image and og:url at the site origin once it is known", () => {
    vi.stubEnv("VITE_SITE_ORIGIN", "https://jigswap.example");
    const head = tags(seoHead(matchFor("en", "/how-it-works"), "howItWorks"));
    expect(head["og:image"]).toBe("https://jigswap.example/icon-512.png");
    expect(head["og:url"]).toBe("https://jigswap.example/how-it-works");
  });
});

describe("headMessage", () => {
  it("formats an ICU message in the visitor's language", () => {
    const values = {
      title: "Café",
      hasMaker: "yes",
      maker: "Jumbo",
      count: 1000,
    };
    expect(
      headMessage(
        { intl: intl("en") },
        "publicCatalog.metaDescription",
        values,
      ),
    ).toBe(
      "Café by Jumbo — 1,000-piece jigsaw puzzle. Community rating, reviews and swap availability on JigSwap.",
    );
    expect(
      headMessage(
        { intl: intl("nl") },
        "publicCatalog.metaDescription",
        values,
      ),
    ).toBe(
      "Café van Jumbo — legpuzzel van 1.000 stukjes. Beoordelingen, reviews en ruilbeschikbaarheid in de JigSwap-community.",
    );
  });

  it("leaves out the maker when there is none", () => {
    expect(
      headMessage({ intl: intl("en") }, "publicCatalog.metaDescription", {
        title: "Café",
        hasMaker: "no",
        maker: "",
        count: 1,
      }),
    ).toBe(
      "Café — 1-piece jigsaw puzzle. Community rating, reviews and swap availability on JigSwap.",
    );
  });

  it("is undefined for a missing key or a context without intl", () => {
    expect(headMessage({ intl: intl("en") }, "marketing.meta.nope")).toBe(
      undefined,
    );
    expect(headMessage({}, "marketing.meta.about")).toBe(undefined);
  });
});
