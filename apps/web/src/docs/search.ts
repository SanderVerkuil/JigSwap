import MiniSearch from "minisearch";
import type { DocPage } from "./types";

export interface SearchDoc {
  id: string;
  slug: string;
  title: string;
  group: string;
  summary: string;
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
      text: p.text,
    }));
}

export type DocsIndex = ReturnType<typeof createDocsIndex>;

export function createDocsIndex(docs: readonly SearchDoc[]) {
  const mini = new MiniSearch<SearchDoc>({
    fields: ["title", "summary", "text"],
    storeFields: ["slug", "title", "group", "text"],
    searchOptions: {
      boost: { title: 3, summary: 2 },
      prefix: true,
      fuzzy: 0.2,
    },
  });
  mini.addAll(docs);
  return {
    search(query: string): SearchHit[] {
      if (!query.trim()) return [];
      return mini
        .search(query)
        .slice(0, 12)
        .map((r) => ({
          slug: r.slug as string,
          title: r.title as string,
          group: r.group as string,
          snippet: makeSnippet(r.text as string, query),
        }));
    },
  };
}

const SNIPPET_LENGTH = 120;
const SNIPPET_LEAD = 40;

// A short excerpt around the first query term, for the result list. It starts and ends on a whole
// word, with an ellipsis where it cuts the text.
function makeSnippet(text: string, query: string): string {
  const term = query.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  const hit = term ? text.toLowerCase().indexOf(term) : -1;
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
