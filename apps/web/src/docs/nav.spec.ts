import { describe, expect, it } from "vitest";
import {
  buildNavTree,
  buildPager,
  findDocPage,
  flattenOrder,
  pagesForLocale,
} from "./nav";
import type { DocMeta } from "./types";

function page(
  slug: string,
  group: string,
  isIndex: boolean,
  title: string,
  order = 0,
  locale = "en",
): DocMeta {
  return {
    id: `${locale}/${isIndex ? (slug ? `${slug}/index` : "index") : slug}`,
    locale,
    slug,
    group,
    isIndex,
    frontmatter: { title, order },
  };
}

const PAGES: DocMeta[] = [
  page("", "", true, "User Guide", 0),
  page("getting-started", "getting-started", true, "Getting Started", 1),
  page(
    "getting-started/accounts-and-sign-in",
    "getting-started",
    false,
    "Accounts",
    1,
  ),
  page(
    "getting-started/finding-your-way-around",
    "getting-started",
    false,
    "Finding Your Way",
    2,
  ),
  page("your-library", "your-library", true, "Your Library", 2),
  page("your-library/collections", "your-library", false, "Collections", 1),
];

describe("pagesForLocale", () => {
  const MIXED: DocMeta[] = [
    page(
      "getting-started",
      "getting-started",
      true,
      "Getting Started",
      1,
      "en",
    ),
    page(
      "getting-started/accounts",
      "getting-started",
      false,
      "Accounts",
      1,
      "en",
    ),
    page("your-library", "your-library", true, "Your Library", 2, "en"),
    // nl overrides one slug, leaves the rest to fall back to en.
    page("getting-started", "getting-started", true, "Aan de slag", 1, "nl"),
  ];

  it("returns all en pages for the en locale", () => {
    const result = pagesForLocale(MIXED, "en");
    expect(result.map((p) => p.slug).sort()).toEqual([
      "getting-started",
      "getting-started/accounts",
      "your-library",
    ]);
    expect(result.every((p) => p.locale === "en")).toBe(true);
  });

  it("overrides where the locale has a page and falls back to en otherwise", () => {
    const result = pagesForLocale(MIXED, "nl");
    const bySlug = new Map(result.map((p) => [p.slug, p]));
    // One entry per unique slug.
    expect(result.length).toBe(3);
    // nl override wins for the slug it provides.
    expect(bySlug.get("getting-started")?.locale).toBe("nl");
    expect(bySlug.get("getting-started")?.frontmatter.title).toBe(
      "Aan de slag",
    );
    // Missing slugs fall back to en.
    expect(bySlug.get("getting-started/accounts")?.locale).toBe("en");
    expect(bySlug.get("your-library")?.locale).toBe("en");
  });
});

describe("buildNavTree", () => {
  it("groups leaf pages under their group, ordered, excluding the root index", () => {
    const tree = buildNavTree(PAGES);
    expect(tree.map((g) => g.title)).toEqual([
      "Getting Started",
      "Your Library",
    ]);
    expect(tree[0].links.map((l) => l.title)).toEqual([
      "Accounts",
      "Finding Your Way",
    ]);
    expect(tree[0].slug).toBe("getting-started");
  });

  // A group's index page lists its articles with these, so the list follows the pages.
  it("carries each page's summary on its link", () => {
    const withSummary: DocMeta = {
      ...page("your-library/shelf", "your-library", false, "Shelf", 2),
      frontmatter: { title: "Shelf", order: 2, summary: "Build your shelf." },
    };
    const tree = buildNavTree([...PAGES, withSummary]);
    expect(tree[1].links.map((l) => [l.title, l.summary])).toEqual([
      ["Collections", undefined],
      ["Shelf", "Build your shelf."],
    ]);
  });
});

describe("buildPager", () => {
  it("returns prev/next across the flattened reading order", () => {
    const tree = buildNavTree(PAGES);
    const order = flattenOrder(tree);
    expect(order).toEqual([
      "getting-started/accounts-and-sign-in",
      "getting-started/finding-your-way-around",
      "your-library/collections",
    ]);
    const pager = buildPager(tree, "getting-started/finding-your-way-around");
    expect(pager.prev?.slug).toBe("getting-started/accounts-and-sign-in");
    expect(pager.next?.slug).toBe("your-library/collections");
  });

  it("has null prev at the start and null next at the end", () => {
    const tree = buildNavTree(PAGES);
    expect(
      buildPager(tree, "getting-started/accounts-and-sign-in").prev,
    ).toBeNull();
    expect(buildPager(tree, "your-library/collections").next).toBeNull();
  });
});

describe("findDocPage", () => {
  it("finds a page by its slug, ignoring a trailing slash", () => {
    expect(
      findDocPage(PAGES, "your-library/collections")?.frontmatter.title,
    ).toBe("Collections");
    expect(
      findDocPage(PAGES, "your-library/collections/")?.frontmatter.title,
    ).toBe("Collections");
  });

  it("finds a group index page", () => {
    expect(findDocPage(PAGES, "your-library")?.isIndex).toBe(true);
  });

  it("prefers a leaf page over an index page with the same slug", () => {
    const both = [
      page("faq", "faq", true, "FAQ index"),
      page("faq", "faq", false, "FAQ page"),
    ];
    expect(findDocPage(both, "faq")?.frontmatter.title).toBe("FAQ page");
  });

  it("is undefined for a slug no page has", () => {
    expect(findDocPage(PAGES, "nope/nope")).toBeUndefined();
    expect(findDocPage(PAGES, undefined)).toBe(findDocPage(PAGES, ""));
  });
});
