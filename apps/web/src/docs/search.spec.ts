import { describe, expect, it } from "vitest";
import { buildSearchDocs, createDocsIndex, type SearchDoc } from "./search";
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
    const index = createDocsIndex(buildSearchDocs(pages), "en");
    const hits = index.search("visibility");
    expect(hits[0].slug).toBe("sharing-and-exchanges/visibility-and-privacy");
  });

  it("starts and ends a snippet on a whole word", () => {
    const text =
      "Swap means trading one puzzle for another puzzle. Sale means selling a puzzle for a price. Lend means letting someone borrow a puzzle and get it back later on, when they are done with it and it is ready for the next one.";
    const index = createDocsIndex([doc("a", "Exchanges", text)], "en");
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
    const index = createDocsIndex([doc("a", "Sales", text)], "en");
    const [hit] = index.search("sales");
    expect(hit.snippet.startsWith("Word Word")).toBe(true);
    expect(hit.snippet.endsWith("Word…")).toBe(true);
  });

  it("returns no hits for an empty query", () => {
    const index = createDocsIndex(buildSearchDocs(pages), "en");
    expect(index.search("   ")).toEqual([]);
  });

  it("cuts the snippet where the most query words sit together, not at the first one typed", () => {
    const text = `Add a photo of your puzzle when you add it. ${"Filler words keep going here. ".repeat(6)}A blurred photo shows a Show button.`;
    const index = createDocsIndex(
      [doc("a", "Messages", text), doc("b", "Other", "Nothing here.")],
      "en",
    );
    const [hit] = index.search("photo blurred");
    expect(hit.snippet).toContain("A blurred photo shows");
  });

  it("finds a page by a hidden keyword", () => {
    const docs = buildSearchDocs([
      leaf("en", "sharing-and-exchanges/lend-swap-trade", "Lend, swap & sell", {
        frontmatter: { title: "Lend, swap & sell", keywords: ["trade"] },
        text: "Swap a puzzle for another one.",
      }),
      leaf("en", "your-library/collections", "Collections"),
    ]);
    expect(docs[0].keywords).toBe("trade");
    const index = createDocsIndex(docs, "en");
    expect(index.search("trade")[0]?.slug).toBe(
      "sharing-and-exchanges/lend-swap-trade",
    );
  });
});

// Questions are full of words that match every page ("how", "my", "ik", "geen"), so the longest
// pages won; a one-letter scrap ("foto's" -> "foto", "s") matched every word starting with it.
describe("docs search ignores filler words", () => {
  // Pages that share the question's real words with Meldingen, and also its filler.
  const filler = (topic: string, more = "") =>
    `Ik zie geen ${topic}? Dan heb ik geen ${topic} gekregen. Je kunt mails krijgen over een ${topic}, en meer, maar ik zie er geen.${more}`;
  const nl = createDocsIndex(
    [
      doc(
        "staying-informed/messages",
        "Berichten",
        filler("bericht", " Soms staat er een foto bij."),
      ),
      doc(
        "sharing-and-exchanges/friend-circles",
        "Vriendenkringen",
        filler("kring"),
      ),
      doc(
        "sharing-and-exchanges/households",
        "Huishoudens",
        filler("huishouden", " Samen sparen, slim selecteren, snel sorteren."),
      ),
      doc(
        "discovering-and-community/people-and-following",
        "Mensen en volgen",
        filler("volger"),
      ),
      doc(
        "staying-informed/notifications",
        "Meldingen",
        "Zet elk meldingstype aan of uit per kanaal. Mails over berichten komen gebundeld, zodat je minder mails gaat krijgen en niet meer per bericht.",
      ),
      doc(
        "help/faq-and-troubleshooting",
        "Veelgestelde vragen",
        "Waarom is een foto vervaagd? De controle was niet zeker.",
      ),
    ],
    "nl",
  );

  it("finds Meldingen for 'ik wil geen mails meer krijgen'", () => {
    const top3 = nl
      .search("ik wil geen mails meer krijgen")
      .slice(0, 3)
      .map((h) => h.title);
    expect(top3).toContain("Meldingen");
  });

  it('ranks "foto\'s vervaagd" as "foto vervaagd"', () => {
    const order = (query: string) => nl.search(query).map((h) => h.slug);
    expect(order("foto's vervaagd")).toEqual(order("foto vervaagd"));
  });

  it("searches a query of only filler words as typed, so a half-typed question still has results", () => {
    const en = createDocsIndex(
      [
        doc("a", "Language", "How the app picks its language."),
        doc("b", "Other", "Nothing to see."),
      ],
      "en",
    );
    expect(en.search("how do I").map((h) => h.slug)).toEqual(["a"]);
  });
});

function doc(slug: string, title: string, text: string): SearchDoc {
  return {
    id: slug,
    slug,
    title,
    group: slug.split("/")[0],
    summary: "",
    keywords: "",
    text,
  };
}

function leaf(
  locale: string,
  slug: string,
  title: string,
  extra: Partial<DocPage> = {},
): DocPage {
  return {
    id: `${locale}/${slug}`,
    locale,
    slug,
    group: slug.split("/")[0],
    isIndex: false,
    frontmatter: { title },
    html: "",
    headings: [],
    text: title,
    ...extra,
  };
}
