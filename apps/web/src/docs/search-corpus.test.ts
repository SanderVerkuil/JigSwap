import { readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { compileMarkdown } from "./markdown";
import { pagesForLocale } from "./nav";
import { buildSearchDocs, createDocsIndex, type DocsIndex } from "./search";
import type { DocPage } from "./types";
import { docPageFromFile } from "./virtual-modules";

// search.spec.ts checks the ranking on small made-up pages. These check that a few questions
// members really ask still find their answer in the real guides, built as vite-plugin-docs.ts
// builds them, when a guide is reworded.
const DOCS = join(import.meta.dirname, "../../../../docs/user");

const indexes: Record<string, DocsIndex> = {};

// Compiling the pages loads Shiki's grammars first, which can be slow on a cold CI machine.
beforeAll(async () => {
  const pages: DocPage[] = [];
  for (const rel of readdirSync(DOCS, { recursive: true, encoding: "utf8" })) {
    if (!rel.endsWith(".md")) continue;
    const raw = readFileSync(join(DOCS, rel), "utf8");
    pages.push(
      docPageFromFile(rel.split(sep).join("/"), await compileMarkdown(raw)),
    );
  }
  for (const locale of ["en", "nl"])
    indexes[locale] = createDocsIndex(
      buildSearchDocs(pagesForLocale(pages, locale)),
      locale,
    );
}, 60000);

// The rows the search dialog shows on a desktop screen.
const top3 = (locale: string, query: string) =>
  indexes[locale].search(query).slice(0, 3);

describe("docs search over the real guides", () => {
  // At the lender's section, not at the borrower's "give back" one just above it.
  it.each([
    [
      "en",
      "my friend has my puzzle and won't give it back",
      "get-a-lent-puzzle-back",
    ],
    [
      "nl",
      "mijn vriendin geeft mijn puzzel niet terug",
      "een-uitgeleende-puzzel-terugkrijgen",
    ],
  ])(
    "finds the lending guide for a friend who won't give a puzzle back (%s)",
    (locale, query, hash) => {
      const lend = top3(locale, query).find(
        (hit) => hit.slug === "sharing-and-exchanges/lend-swap-trade",
      );
      expect(lend?.hash).toBe(hash);
    },
  );

  // At the section on offering a puzzle, not at getting a lent one back, which also says "friend".
  it.each([
    [
      "en",
      "how do I lend a puzzle to a friend",
      "offer-your-puzzle-to-swap-lend-or-sell",
    ],
    [
      "nl",
      "hoe leen ik een puzzel uit aan een vriend",
      "je-puzzel-aanbieden-om-te-ruilen-uit-te-lenen-of-te-verkopen",
    ],
  ])(
    "finds the lending guide for lending a puzzle to a friend (%s)",
    (locale, query, hash) => {
      const lend = top3(locale, query).find(
        (hit) => hit.slug === "sharing-and-exchanges/lend-swap-trade",
      );
      expect(lend?.hash).toBe(hash);
    },
  );

  // In the two rows a phone shows: "meer" once matched a FAQ question about a partner who no
  // longer answers.
  it("finds Meldingen for a member who wants no more mail", () => {
    expect(
      top3("nl", "ik wil geen mails meer krijgen")
        .slice(0, 2)
        .map((hit) => hit.slug),
    ).toContain("staying-informed/notifications");
  });

  it("opens Messages at its blurred photos section", () => {
    const messages = top3("en", "blurred").find(
      (hit) => hit.slug === "staying-informed/messages",
    );
    expect(messages).toMatchObject({
      section: "Blurred photos",
      hash: "blurred-photos",
    });
  });
});
