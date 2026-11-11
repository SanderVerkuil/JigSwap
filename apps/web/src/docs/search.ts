import MiniSearch from "minisearch";
import type { DocPage } from "./types";

export interface SearchDoc {
  id: string;
  slug: string;
  title: string;
  group: string;
  summary: string;
  keywords: string;
  text: string;
}

export interface SearchHit {
  slug: string;
  title: string;
  group: string;
  snippet: string;
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
      text: p.text,
    }));
}

// Words that match nearly every page, so in a question ("how do I…", "ik wil geen…") they made
// the longest pages win. "who" / "wie" stay: "Who sees a copy" is a heading. MiniSearch splits
// words at an apostrophe, so "can't" arrives as "can" and "t".
const STOP_WORDS: Readonly<Record<string, ReadonlySet<string>>> = {
  en: new Set(
    "a an the i im my me we our you your do does did how to of in on at for is are was be can cant could what why when where which with and or it its this that from as by not no if so get got".split(
      " ",
    ),
  ),
  nl: new Set(
    "de het een ik je jij jou mijn me mij we wij ons hoe wat waarom wanneer waar kan kun kunnen niet geen in op aan van voor met en of te is er dat die dit zijn word wordt ben bij om naar dan als ook nog".split(
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
    fields: ["title", "summary", "text", "keywords"],
    storeFields: ["slug", "title", "group", "text"],
    searchOptions: {
      boost: { title: 3, summary: 2, keywords: 2 },
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
      return results.slice(0, 12).map((r) => ({
        slug: r.slug as string,
        title: r.title as string,
        group: r.group as string,
        snippet: makeSnippet(
          r.text as string,
          r.terms,
          words.length ? words : typed,
        ),
      }));
    },
  };
}

const SNIPPET_LENGTH = 120;
const SNIPPET_LEAD = 40;

// A short excerpt for the result list, cut where the most different query words sit within one
// excerpt's reach (the text's opening if none is in it). `terms` are the words of the page that
// MiniSearch matched, typos and longer words included; each counts for the query word it matched.
function makeSnippet(
  text: string,
  terms: readonly string[],
  words: readonly string[],
): string {
  const matched = new Set(terms);
  const found: { at: number; end: number; word: string }[] = [];
  for (const m of text.matchAll(WORD)) {
    const term = m[0].toLowerCase();
    if (matched.has(term))
      found.push({
        at: m.index,
        end: m.index + m[0].length,
        word: queryWordOf(term, words),
      });
  }
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
// one it shares the longest start with.
function queryWordOf(term: string, words: readonly string[]): string {
  let best = term;
  let shared = -1;
  for (const word of words) {
    let n = 0;
    while (n < word.length && word[n] === term[n]) n++;
    if (n > shared) {
      shared = n;
      best = word;
    }
  }
  return best;
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
