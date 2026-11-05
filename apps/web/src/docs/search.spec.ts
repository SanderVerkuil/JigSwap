import { describe, expect, it } from "vitest";
import { buildSearchDocs, createDocsIndex } from "./search";
import type { DocPage } from "./types";

const pages: DocPage[] = [
  {
    id: "en/your-library/collections",
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
    id: "en/sharing-and-exchanges/visibility-and-privacy",
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
    id: "en/your-library/index",
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

  it("starts and ends a snippet on a whole word", () => {
    const text =
      "Swap means trading one puzzle for another puzzle. Sale means selling a puzzle for a price. Lend means letting someone borrow a puzzle and get it back later on, when they are done with it and it is ready for the next one.";
    const index = createDocsIndex([
      {
        id: "a",
        slug: "a",
        title: "Exchanges",
        group: "g",
        summary: "",
        text,
      },
    ]);
    const [hit] = index.search("Lend");
    expect(hit.snippet).toMatch(/^…(\S+ )+Lend means /);
    expect(hit.snippet).toMatch(/ \S+…$/);
    // Every word in it is a whole word of the text.
    const words = new Set(text.split(" "));
    for (const word of hit.snippet.replaceAll("…", "").split(" ")) {
      expect(words).toContain(word);
    }
  });

  it("shows a long text's opening when the term isn't literally in it", () => {
    const text = "Word ".repeat(40).trim();
    const index = createDocsIndex([
      { id: "a", slug: "a", title: "Sales", group: "g", summary: "", text },
    ]);
    const [hit] = index.search("sales");
    expect(hit.snippet.startsWith("Word Word")).toBe(true);
    expect(hit.snippet.endsWith("Word…")).toBe(true);
  });

  it("returns no hits for an empty query", () => {
    const index = createDocsIndex(buildSearchDocs(pages));
    expect(index.search("   ")).toEqual([]);
  });
});
