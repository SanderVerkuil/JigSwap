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

// A short excerpt centred on the first query term, for the result list.
function makeSnippet(text: string, query: string): string {
  const term = query.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  const i = term ? text.toLowerCase().indexOf(term) : -1;
  if (i === -1) return text.slice(0, 120);
  const start = Math.max(0, i - 40);
  return (start > 0 ? "…" : "") + text.slice(start, start + 120).trim() + "…";
}
