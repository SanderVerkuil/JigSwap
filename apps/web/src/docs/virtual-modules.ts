import type { CompiledDoc } from "./markdown";
import { pagesForLocale } from "./nav";
import { buildSearchDocs } from "./search";
import type { DocMeta, DocPage } from "./types";

// The docs ship as several virtual modules (served by vite-plugin-docs.ts) so
// that no page carries the whole user guide:
//   virtual:docs                 every page's DocMeta (nav, landing grid, lookup)
//   virtual:docs/content         pageLoaders: page id -> import of that page's body
//   virtual:docs/page/<id>       one page's DocContent (html, headings)
//   virtual:docs/search          searchLoaders: locale -> import of its corpus
//   virtual:docs/search/<locale> that locale's search docs (en fills the gaps)
// Pure (no fs, no Vite) so the module shapes are unit-tested.
export const DOCS_MODULE = "virtual:docs";
const CONTENT_MODULE = `${DOCS_MODULE}/content`;
const PAGE_PREFIX = `${DOCS_MODULE}/page/`;
const SEARCH_MODULE = `${DOCS_MODULE}/search`;
const SEARCH_PREFIX = `${SEARCH_MODULE}/`;

export function isDocsModule(id: string): boolean {
  return id === DOCS_MODULE || id.startsWith(`${DOCS_MODULE}/`);
}

// A compiled Markdown file as a page. `rel` is its path under docs/user with
// POSIX separators (fast-glob's output): <locale>/<...slug>.md, where the first
// segment selects the locale and the rest forms the locale-agnostic slug.
export function docPageFromFile(rel: string, compiled: CompiledDoc): DocPage {
  const id = rel.replace(/\.md$/, "");
  const parts = id.split("/");
  const locale = parts[0];
  const rest = parts.slice(1);
  const isIndex = rest[rest.length - 1] === "index";
  const slug = (isIndex ? rest.slice(0, -1) : rest).join("/");
  const group = slug.includes("/") ? slug.split("/")[0] : slug;
  return {
    id,
    locale,
    slug,
    group,
    isIndex,
    frontmatter: compiled.frontmatter,
    html: compiled.html,
    headings: compiled.headings,
    text: compiled.text,
    sections: compiled.sections,
  };
}

// Source of the docs virtual module `id`, or null when no such module exists
// (an unknown page id or locale).
export function renderDocsModule(
  id: string,
  pages: readonly DocPage[],
): string | null {
  if (id === DOCS_MODULE) {
    return exportConst("pages", pages.map(toMeta));
  }
  if (id === CONTENT_MODULE) {
    return exportLoaders(
      "pageLoaders",
      pages.map((p) => [p.id, PAGE_PREFIX + p.id]),
    );
  }
  if (id === SEARCH_MODULE) {
    return exportLoaders(
      "searchLoaders",
      localesOf(pages).map((locale) => [locale, SEARCH_PREFIX + locale]),
    );
  }
  if (id.startsWith(PAGE_PREFIX)) {
    const page = pages.find((p) => p.id === id.slice(PAGE_PREFIX.length));
    if (!page) return null;
    return (
      exportConst("html", page.html) + exportConst("headings", page.headings)
    );
  }
  if (id.startsWith(SEARCH_PREFIX)) {
    const locale = id.slice(SEARCH_PREFIX.length);
    if (!localesOf(pages).includes(locale)) return null;
    return exportConst("docs", buildSearchDocs(pagesForLocale(pages, locale)));
  }
  return null;
}

function toMeta({
  id,
  locale,
  slug,
  group,
  isIndex,
  frontmatter,
}: DocPage): DocMeta {
  return { id, locale, slug, group, isIndex, frontmatter };
}

function localesOf(pages: readonly DocPage[]): string[] {
  return [...new Set(pages.map((p) => p.locale))];
}

const UNSAFE_IN_CODE: Readonly<Record<string, string>> = {
  "<": "\\u003C",
  ">": "\\u003E",
  "\b": "\\b",
  "\f": "\\f",
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t",
  "\0": "\\0",
  "\u2028": "\\u2028",
  "\u2029": "\\u2029",
};

// JSON is a JS literal, except that it may still hold characters that end a script element or a
// line. Doc text and slugs come from Markdown files, so escape those before generating code.
function toCodeLiteral(value: unknown): string {
  return JSON.stringify(value).replace(
    /[<>\b\f\n\r\t\0\u2028\u2029]/g,
    (char) => UNSAFE_IN_CODE[char] ?? char,
  );
}

function exportConst(name: string, value: unknown): string {
  return `export const ${name} = ${toCodeLiteral(value)};\n`;
}

// Each entry a lazy import, so the bundler emits one chunk per target module.
function exportLoaders(
  name: string,
  entries: readonly (readonly [key: string, moduleId: string])[],
): string {
  const body = entries
    .map(
      ([key, moduleId]) =>
        `  ${toCodeLiteral(key)}: () => import(${toCodeLiteral(moduleId)}),`,
    )
    .join("\n");
  return `export const ${name} = {\n${body}\n};\n`;
}
