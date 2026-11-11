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
    sections: [],
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
    sections: [],
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
    sections: [],
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

// Pages rank as they are; each result then opens at its best section.
describe("docs search opens a result at its section", () => {
  const messages = sectioned(
    "staying-informed/messages",
    "Messages",
    "Messages is where you talk to other members.",
    [
      [
        "send-photos",
        "Send photos",
        "Attach photos to a message. Each photo is checked, and a photo can take a moment.",
      ],
      [
        "blurred-photos",
        "Blurred photos",
        "A photo is blurred at first when the check was not sure. Click Show to see it.",
      ],
    ],
  );
  const faq = sectioned(
    "help/faq-and-troubleshooting",
    "FAQ & troubleshooting",
    "Choose a question to see the answer.",
    [
      [
        "why-cant-i-reply",
        "Why can't I reply to a conversation?",
        "The other member is no longer reachable by you.",
      ],
    ],
  );
  const households = sectioned(
    "sharing-and-exchanges/households",
    "Households",
    "A household lets the people you live with share one puzzle library.",
    [["invite-someone", "Invite someone", "Only the admin can invite."]],
  );
  const index = createDocsIndex([messages, faq, households], "en");

  it("opens at the section with the most of the query's words, and says so in the row", () => {
    const [hit] = index.search("photo blurred");
    expect(hit).toMatchObject({
      slug: "staying-informed/messages",
      title: "Messages",
      section: "Blurred photos",
      hash: "blurred-photos",
    });
    // The snippet comes from that section, after its title.
    expect(hit.snippet.startsWith("A photo is blurred")).toBe(true);
  });

  it("opens at a FAQ question", () => {
    const [hit] = index.search("can't reply");
    expect(hit).toMatchObject({
      section: "Why can't I reply to a conversation?",
      hash: "why-cant-i-reply",
    });
  });

  it("opens at the top when the page's opening holds the most", () => {
    const [hit] = index.search("puzzle library");
    expect(hit.slug).toBe("sharing-and-exchanges/households");
    expect(hit.section).toBeUndefined();
    expect(hit.hash).toBeUndefined();
  });

  it("lists each page once, however many of its sections match", () => {
    expect(index.search("photo").map((h) => h.slug)).toEqual([
      "staying-informed/messages",
    ]);
  });

  // "heeft" is a typo-match for "geeft" that shares no first letter with any query word; it once
  // counted for the first word typed, "vriend", and tied the sections.
  it("counts a typo in a word's first letter for the word it's closest to", () => {
    const lend = sectioned(
      "sharing-and-exchanges/lend-swap-trade",
      "Uitlenen",
      "Leen een puzzel uit.",
      [
        [
          "teruggeven",
          "Teruggeven",
          "Geef de puzzel pas terug als de uitlener hem heeft.",
        ],
        [
          "terugkrijgen",
          "Terugkrijgen",
          "Je vriend geeft de puzzel niet terug?",
        ],
      ],
    );
    const [hit] = createDocsIndex([lend], "nl").search("vriend geeft puzzel");
    expect(hit.hash).toBe("terugkrijgen");
  });

  it("breaks a tie between sections by the filler words in their titles", () => {
    const lend = sectioned(
      "sharing-and-exchanges/lend-swap-trade",
      "Lend, swap & sell",
      "Lend a copy.",
      [
        [
          "give-back",
          "Give back a puzzle you borrowed",
          "Return it once the lender has the puzzle back.",
        ],
        [
          "get-back",
          "Get a lent puzzle back",
          "Want the puzzle back? Recall it.",
        ],
      ],
    );
    const index = createDocsIndex([lend], "en");
    expect(index.search("get my puzzle back")[0].hash).toBe("get-back");
    // Filler words alone don't move a result off the page's opening.
    const opening = sectioned("a", "Language", "Change the language.", [
      ["the-app", "The app", "Change the language."],
    ]);
    const [hit] = createDocsIndex([opening], "en").search(
      "change the language",
    );
    expect(hit.hash).toBeUndefined();
  });

  it("picks no section for a query of only filler words", () => {
    expect(index.search("why can't I").every((h) => !h.hash)).toBe(true);
  });

  it("ranks a page by its headings", () => {
    const loans = sectioned(
      "sharing-and-exchanges/lend-swap-trade",
      "Lend, swap & sell",
      "Lending, swapping and selling puzzles with other members, step by step, from the first request to the end.",
      [["recall-a-loan", "Recall a loan", "Ask for it back early."]],
    );
    const other = doc("a", "Other", "You can recall it.");
    const [hit] = createDocsIndex([other, loans], "en").search("recall");
    expect(hit.slug).toBe("sharing-and-exchanges/lend-swap-trade");
  });

  it("builds the corpus with each page's section titles as its headings", () => {
    const [built] = buildSearchDocs([
      leaf("en", "staying-informed/messages", "Messages", {
        text: messages.text,
        sections: messages.sections,
      }),
    ]);
    expect(built.headings).toBe("Send photos Blurred photos");
    expect(built.sections).toEqual(messages.sections);
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
    headings: "",
    text,
    sections: [],
  };
}

// A page's search text as compileMarkdown builds it: its opening, then each section's title and
// body, with where each section lies in it.
function sectioned(
  slug: string,
  title: string,
  opening: string,
  parts: [id: string, title: string, body: string][],
): SearchDoc {
  let text = opening;
  const sections = parts.map(([id, heading, body]) => {
    const start = text.length + 1;
    text += ` ${heading} ${body}`;
    return { id, title: heading, start, end: text.length };
  });
  return {
    ...doc(slug, title, text),
    headings: parts.map(([, heading]) => heading).join(" "),
    sections,
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
    sections: [],
    ...extra,
  };
}
