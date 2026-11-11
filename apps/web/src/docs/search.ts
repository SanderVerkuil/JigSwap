import MiniSearch from "minisearch";
import type { DocPage, DocSection } from "./types";

export interface SearchDoc {
  id: string;
  slug: string;
  title: string;
  group: string;
  summary: string;
  keywords: string;
  headings: string; // the titles of its sections, h2/h3 and FAQ questions
  text: string;
  sections: DocSection[];
}

export interface SearchHit {
  slug: string;
  title: string;
  group: string;
  snippet: string;
  // The heading or FAQ question the result opens at, and its id; none when it opens at the top.
  section?: string;
  hash?: string;
}

// Leaf pages only — index and root pages are navigation hubs, not search targets.
// Runs at build time (vite-plugin-docs.ts): each locale's search corpus is a
// module of its own that the search dialog loads when it first opens.
export function buildSearchDocs(pages: readonly DocPage[]): SearchDoc[] {
  return pages
    .filter((p) => !p.isIndex && p.slug !== "")
    .map((p) => ({
      id: p.slug,
      slug: p.slug,
      title: p.frontmatter.title,
      group: p.group,
      summary: p.frontmatter.summary ?? "",
      keywords: (p.frontmatter.keywords ?? []).join(" "),
      headings: p.sections.map((s) => s.title).join(" "),
      text: p.text,
      sections: p.sections,
    }));
}

// Words that match nearly every page, so in a question ("how do I…", "ik wil geen…") they made
// the longest pages win. "who" / "wie" stay: "Who sees a copy" is a heading. MiniSearch splits
// words at an apostrophe, so "can't" arrives as "can" and "t". "meer" is the "no longer" of
// "niet meer".
const STOP_WORDS: Readonly<Record<string, ReadonlySet<string>>> = {
  en: new Set(
    "a an the i im my me we our you your do does did how to of in on at for is are was be can cant could what why when where which with and or it its this that from as by not no if so get got".split(
      " ",
    ),
  ),
  nl: new Set(
    "de het een ik je jij jou mijn me mij we wij ons hoe wat waarom wanneer waar kan kun kunnen niet geen in op aan van voor met en of te is er dat die dit zijn word wordt ben bij om naar dan als ook nog meer".split(
      " ",
    ),
  ),
};

// A word as MiniSearch's default tokenizer cuts them: a run of anything but space and punctuation.
const WORD = /[^\n\r\p{Z}\p{P}]+/gu;

export type DocsIndex = ReturnType<typeof createDocsIndex>;

export function createDocsIndex(docs: readonly SearchDoc[], locale: string) {
  const stopWords = STOP_WORDS[locale] ?? STOP_WORDS.en;
  // Leaves out a stop word, and a one-letter scrap such as the "s" of "foto's", which as a prefix
  // matched every word starting with it.
  const isContentWord = (word: string) =>
    word.length >= 2 && !stopWords.has(word);
  const mini = new MiniSearch<SearchDoc>({
    fields: ["title", "summary", "headings", "text", "keywords"],
    storeFields: ["slug", "title", "group", "text", "sections"],
    searchOptions: {
      boost: { title: 3, summary: 2, headings: 2, keywords: 2 },
      prefix: true,
      fuzzy: 0.2,
      // The query's words only: the index keeps every word.
      processTerm: (term) => {
        const word = term.toLowerCase();
        return isContentWord(word) ? word : null;
      },
    },
  });
  mini.addAll(docs);
  return {
    search(query: string): SearchHit[] {
      if (!query.trim()) return [];
      const typed = query.toLowerCase().match(WORD) ?? [];
      const words = typed.filter(isContentWord);
      // Only filler so far ("how do I", halfway through a question): search what's typed, as
      // before, rather than flash "No results".
      const results = words.length
        ? mini.search(query)
        : mini.search(query, {
            processTerm: MiniSearch.getDefault("processTerm"),
          });
      return results.slice(0, 12).map((r) => {
        const text = r.text as string;
        // Pages rank as they are; each then opens at its best section. Filler alone picks none.
        const section = words.length
          ? bestSection(
              text,
              r.sections as DocSection[],
              matchesIn(text, r.terms, words),
            )
          : undefined;
        const answer = section
          ? text.slice(section.start + section.title.length, section.end)
          : "";
        return {
          slug: r.slug as string,
          title: r.title as string,
          group: r.group as string,
          snippet: makeSnippet(
            answer.trim() || text,
            r.terms,
            words.length ? words : typed,
          ),
          section: section?.title,
          hash: section?.id,
        };
      });
    },
  };
}

type Match = { at: number; end: number; word: string };

// The words of `text` that MiniSearch matched (`terms`, typos and longer words included), each
// with the query word it counts for.
function matchesIn(
  text: string,
  terms: readonly string[],
  words: readonly string[],
): Match[] {
  const matched = new Set(terms);
  const found: Match[] = [];
  for (const m of text.matchAll(WORD)) {
    const term = m[0].toLowerCase();
    if (matched.has(term))
      found.push({
        at: m.index,
        end: m.index + m[0].length,
        word: queryWordOf(term, words),
      });
  }
  return found;
}

// How many different query words the matches between `from` and `to` stand for.
function wordsBetween(found: readonly Match[], from: number, to: number) {
  return new Set(
    found.filter((f) => f.at >= from && f.end <= to).map((f) => f.word),
  ).size;
}

// The section with the most different query words in it, its title included. The page's opening,
// before the first section, competes too: when it has the most, the result opens at the top. On a
// tie, the section with more of them in its title wins, then the first.
function bestSection(
  text: string,
  sections: readonly DocSection[],
  found: readonly Match[],
): DocSection | undefined {
  let best: DocSection | undefined;
  let most = wordsBetween(found, 0, sections[0]?.start ?? text.length);
  let mostInTitle = 0;
  for (const s of sections) {
    const all = wordsBetween(found, s.start, s.end);
    const inTitle = wordsBetween(found, s.start, s.start + s.title.length);
    if (all > most || (all === most && inTitle > mostInTitle)) {
      best = s;
      most = all;
      mostInTitle = inTitle;
    }
  }
  return best;
}

const SNIPPET_LENGTH = 120;
const SNIPPET_LEAD = 40;

// A short excerpt for the result list, cut where the most different query words sit within one
// excerpt's reach (the text's opening if none is in it). `terms` are the words of the page that
// MiniSearch matched; each counts for the query word it matched.
function makeSnippet(
  text: string,
  terms: readonly string[],
  words: readonly string[],
): string {
  const found = matchesIn(text, terms, words);
  let hit = -1;
  let most = 0;
  for (let i = 0; i < found.length; i++) {
    const near = new Set([found[i].word]);
    const reach = found[i].at + SNIPPET_LENGTH - SNIPPET_LEAD;
    for (let j = i + 1; j < found.length && found[j].end <= reach; j++)
      near.add(found[j].word);
    if (near.size > most) {
      most = near.size;
      hit = found[i].at;
    }
  }
  return cutSnippet(text, hit);
}

// The query word a matched word of the page came from: the one it starts with, or (a typo) the
// one it shares the longest start with. A typo in the first letter shares no start with any of
// them ("heeft" for "geeft"): it comes from the one it's closest to, not the first one typed.
function queryWordOf(term: string, words: readonly string[]): string {
  let best = term;
  let shared = 0;
  for (const word of words) {
    let n = 0;
    while (n < word.length && word[n] === term[n]) n++;
    if (n > shared) {
      shared = n;
      best = word;
    }
  }
  if (shared > 0) return best;
  let fewest = Infinity;
  for (const word of words) {
    const edits = editDistance(word, term);
    if (edits < fewest) {
      fewest = edits;
      best = word;
    }
  }
  return best;
}

// How many letters to add, drop or change to turn one word into the other (Levenshtein).
function editDistance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(
        row[j] + 1,
        next[j - 1] + 1,
        row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    row = next;
  }
  return row[b.length];
}

// SNIPPET_LENGTH of the text, starting SNIPPET_LEAD before `hit`. It starts and ends on a whole
// word, with an ellipsis where it cuts the text.
function cutSnippet(text: string, hit: number): string {
  let start = Math.max(0, hit - SNIPPET_LEAD);
  if (start > 0 && text[start - 1] !== " ") {
    // Unless the term is in the word being cut, skip to the next word.
    const nextWord = text.indexOf(" ", start) + 1;
    if (nextWord > 0 && nextWord <= hit) start = nextWord;
  }
  let end = start + SNIPPET_LENGTH;
  if (end < text.length && text[end] !== " ") {
    const lastSpace = text.lastIndexOf(" ", end);
    if (lastSpace > Math.max(start, hit)) end = lastSpace;
  }
  return (
    (start > 0 ? "…" : "") +
    text.slice(start, end).trim() +
    (end < text.length ? "…" : "")
  );
}
