export interface DocFrontmatter {
  title: string;
  order?: number;
  summary?: string;
}

export interface DocHeading {
  id: string;
  text: string;
  depth: 2 | 3; // h2/h3 only in the on-page TOC
}

export interface DocPage {
  locale: string; // first path segment under docs/user, e.g. "en" / "nl"
  slug: string; // e.g. "getting-started/accounts-and-sign-in" (no leading slash); "" for docs/user/<locale>/index.md
  group: string; // first path segment, e.g. "getting-started"; "" for the root index
  isIndex: boolean; // true for any index.md
  frontmatter: DocFrontmatter;
  html: string;
  headings: DocHeading[];
  text: string; // plain text for the search index
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
