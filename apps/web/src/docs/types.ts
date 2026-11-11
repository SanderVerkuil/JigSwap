export interface DocFrontmatter {
  title: string;
  order?: number;
  summary?: string;
  // Words members search with that the page doesn't use itself; only search reads them.
  keywords?: string[];
}

export interface DocHeading {
  id: string;
  text: string;
  depth: 2 | 3; // h2/h3 only in the on-page TOC
}

// What the nav, landing grid and page lookup need for every page
// (`virtual:docs`). Bodies are split off so the docs layout doesn't ship every
// page's HTML: see vite-plugin-docs.ts and docs/virtual-modules.ts.
export interface DocMeta {
  id: string; // source path under docs/user without ".md", e.g. "en/getting-started/index"; unique per page
  locale: string; // first path segment under docs/user, e.g. "en" / "nl"
  slug: string; // e.g. "getting-started/accounts-and-sign-in" (no leading slash); "" for docs/user/<locale>/index.md
  group: string; // first path segment, e.g. "getting-started"; "" for the root index
  isIndex: boolean; // true for any index.md
  frontmatter: DocFrontmatter;
}

// One page's rendered body, loaded on demand (`virtual:docs/page/<id>`).
export interface DocContent {
  html: string;
  headings: DocHeading[];
}

// A part of a page that a search result can open at: an h2/h3, or a FAQ question.
export interface DocSection {
  id: string; // the heading's id, or the question's <details> id
  title: string; // the heading, or the question
  start: number; // where its title starts in the page's search text
  end: number; // where its text ends there
}

// A compiled page as the build sees it, before it is split into modules.
export interface DocPage extends DocMeta, DocContent {
  text: string; // plain text for the search index
  sections: DocSection[]; // in document order
}

export interface NavLink {
  title: string;
  slug: string;
  order: number;
}
export interface NavGroup {
  title: string;
  slug: string; // group dir slug
  order: number;
  links: NavLink[];
}
export type NavTree = NavGroup[];

export interface PagerLink {
  title: string;
  slug: string;
}
export interface Pager {
  prev: PagerLink | null;
  next: PagerLink | null;
}
