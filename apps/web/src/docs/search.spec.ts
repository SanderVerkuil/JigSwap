import { describe, expect, it } from "vitest";
import { buildSearchDocs, createDocsIndex } from "./search";
import type { DocPage } from "./types";

const pages: DocPage[] = [
  {
    locale: "en",
    slug: "your-library/collections",
    group: "your-library",
    isIndex: false,
    frontmatter: { title: "Collections" },
    html: "",
    headings: [],
    text: "Create a collection to group puzzles together.",
  },
  {
    locale: "en",
    slug: "sharing-and-exchanges/visibility-and-privacy",
    group: "sharing-and-exchanges",
    isIndex: false,
    frontmatter: { title: "Visibility & Privacy" },
    html: "",
    headings: [],
    text: "Control who can see your puzzles with visibility settings.",
  },
  {
    locale: "en",
    slug: "your-library",
    group: "your-library",
    isIndex: true,
    frontmatter: { title: "Your Library" },
    html: "",
    headings: [],
    text: "Library overview.",
  },
];

describe("docs search", () => {
  it("excludes index/root pages and keeps leaf docs", () => {
    const docs = buildSearchDocs(pages);
    expect(docs).toHaveLength(2);
    expect(docs[0]).toMatchObject({
      slug: "your-library/collections",
      title: "Collections",
    });
  });

  it("finds a page by body keyword", () => {
    const index = createDocsIndex(buildSearchDocs(pages));
    const hits = index.search("visibility");
    expect(hits[0].slug).toBe("sharing-and-exchanges/visibility-and-privacy");
  });

  it("returns no hits for an empty query", () => {
    const index = createDocsIndex(buildSearchDocs(pages));
    expect(index.search("   ")).toEqual([]);
  });
});
