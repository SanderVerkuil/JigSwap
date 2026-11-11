import rehypeShiki from "@shikijs/rehype"; // default export is the rehype plugin
import matter from "gray-matter";
import type { Element, Nodes, Root } from "hast";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypeExternalLinks from "rehype-external-links";
import rehypeRaw from "rehype-raw";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import type { DocFrontmatter, DocHeading, DocSection } from "./types";

// Extra fields the transforms below stash on the vfile for compileMarkdown to read.
type DocData = { headings?: DocHeading[]; title?: string };

// Collect h2/h3 headings (with the ids rehype-slug assigns) for the on-page TOC.
function collectHeadings() {
  return (tree: Root, file: { data: Record<string, unknown> }) => {
    const headings: DocHeading[] = [];
    visit(tree, (node) => {
      if (node.type !== "element") return;
      if (node.tagName === "h2" || node.tagName === "h3") {
        const id = node.properties?.id;
        headings.push({
          id: typeof id === "string" ? id : "",
          text: toText(node),
          depth: node.tagName === "h2" ? 2 : 3,
        });
      }
    });
    (file.data as DocData).headings = headings;
  };
}

// Strip the first/leading H1 from the rendered body so each page has exactly one
// H1 (the route injects its own from frontmatter). The stripped H1's text is
// exposed on `file.data.title` as a fallback page title.
function stripLeadingH1() {
  return (tree: Root, file: { data: Record<string, unknown> }) => {
    // Only the genuinely leading heading: the first top-level *element* must be
    // an h1. A mid-page h1 the author wrote intentionally is left untouched.
    const index = tree.children.findIndex((node) => node.type === "element");
    if (index === -1) return;
    const first = tree.children[index];
    if (first.type !== "element" || first.tagName !== "h1") return;
    tree.children.splice(index, 1);
    (file.data as DocData).title = toText(first).trim();
  };
}

// Turn `> **Note:** ...` blockquotes into branded callouts. The first strong
// child whose text matches a known tone keyword selects the tone. Keywords are
// recognized in English and Dutch so localized docs render callouts too.
const TONES: Record<string, string> = {
  // English
  note: "info",
  info: "info",
  tip: "tip",
  warning: "warning",
  caution: "warning",
  danger: "danger",
  important: "danger",
  // Dutch
  opmerking: "info",
  "let op": "info",
  waarschuwing: "warning",
  voorzichtig: "warning",
  gevaar: "danger",
  belangrijk: "danger",
};
function calloutsFromBlockquotes() {
  return (tree: Root) => {
    visit(tree, (node) => {
      if (node.type !== "element" || node.tagName !== "blockquote") return;
      // Only treat as a callout when the blockquote's first paragraph *leads*
      // with a tone keyword in bold (e.g. `> **Note:** ...`). This avoids
      // reclassifying ordinary quotes that merely contain bold text deeper in.
      const firstPara = node.children.find(
        (c): c is Element => c.type === "element" && c.tagName === "p",
      );
      const leadStrong = firstPara?.children.find(
        (c): c is Element => c.type === "element" && c.tagName === "strong",
      );
      if (!leadStrong) return;
      const key = toText(leadStrong).replace(/:$/, "").trim().toLowerCase();
      const tone = TONES[key];
      if (!tone) return;
      node.tagName = "aside";
      node.properties = { className: ["docs-callout"], "data-tone": tone };
    });
  };
}

// Give each FAQ question (a <details> with a <summary>) an id slugged from the question, as
// rehype-slug ids headings, so a search result can open the page at it. The id goes on <details>:
// the router scrolls to it there, but not to an id inside the closed answer. An id a heading or an
// earlier question already has gets "-1", "-2"… on the end.
function slugQuestions() {
  return (tree: Root) => {
    const taken = new Set<string>();
    visit(tree, (node) => {
      if (node.type === "element" && typeof node.properties.id === "string")
        taken.add(node.properties.id);
    });
    visit(tree, (node) => {
      if (node.type !== "element" || node.tagName !== "details") return;
      if (node.properties.id) return;
      const summary = node.children.find(
        (c): c is Element => c.type === "element" && c.tagName === "summary",
      );
      const base = summary ? slug(toText(summary)) : "";
      if (!base) return;
      let id = base;
      for (let n = 1; taken.has(id); n++) id = `${base}-${n}`;
      taken.add(id);
      node.properties = { id, ...node.properties };
    });
  };
}

// github-slugger's slug, which rehype-slug uses: lowercase, punctuation dropped, a hyphen per space.
function slug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
    .replace(/ /g, "-");
}

// Recursively extract the text content of any hast node.
function toText(node: Nodes): string {
  if (node.type === "text") return node.value;
  if ("children" in node) return node.children.map(toText).join("");
  return "";
}

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  // allowDangerousHtml + rehypeRaw lets first-party docs use raw HTML such as
  // <details>/<summary> for collapsible sections (e.g. the FAQ). Content is
  // trusted (build-time, repo-authored), so this is safe; rehypeRaw reparses the
  // raw nodes into real elements before the downstream transforms run.
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRaw)
  .use(rehypeSlug)
  .use(slugQuestions)
  // External links open in a new tab; the .docs-prose ↗ affordance keys off
  // the resulting target="_blank". Internal links (relative/root paths) are
  // left untouched.
  .use(rehypeExternalLinks, {
    target: "_blank",
    rel: ["noopener", "noreferrer"],
  })
  .use(rehypeAutolinkHeadings, { behavior: "wrap" })
  // Build-time syntax highlighting for fenced code blocks. Emits inline styles
  // (no client JS, no FOUC) with both light/dark themes baked in.
  .use(rehypeShiki, {
    themes: { light: "github-light", dark: "github-dark" },
  })
  .use(collectHeadings)
  .use(stripLeadingH1)
  .use(calloutsFromBlockquotes)
  .use(rehypeStringify);

export interface CompiledDoc {
  frontmatter: DocFrontmatter;
  html: string;
  headings: DocHeading[];
  text: string;
  sections: DocSection[];
  title?: string;
}

export async function compileMarkdown(raw: string): Promise<CompiledDoc> {
  const { content, data } = matter(raw);
  const file = await processor.process(content);
  const html = String(file);
  const docData = file.data as DocData;
  return {
    frontmatter: data as DocFrontmatter,
    html,
    headings: docData.headings ?? [],
    ...searchText(html),
    title: docData.title,
  };
}

// The sections a search result can open at: each h2/h3, and each FAQ question (a <details> with
// an id from slugQuestions and a <summary>). The HTML is this processor's own output, so the tags
// are known. A question ends at its </details>; text after it, before the next section, belongs
// to none.
const SECTION_TAG =
  /<(h[23])\b[^>]*?\sid="([^"]+)"[^>]*>([\s\S]*?)<\/\1>|<details\b[^>]*?\sid="([^"]+)"[^>]*>\s*<summary\b[^>]*>([\s\S]*?)<\/summary>|<\/details>/g;

// The page's plain text, stripHtml(html), built piece by piece to know where each section lies in it.
function searchText(html: string): { text: string; sections: DocSection[] } {
  let text = "";
  const add = (fragment: string) => {
    const piece = stripHtml(fragment);
    if (piece) text += (text ? " " : "") + piece;
    return piece;
  };
  const sections: DocSection[] = [];
  let open: DocSection | undefined;
  let question = false;
  let last = 0;
  for (const m of html.matchAll(SECTION_TAG)) {
    add(html.slice(last, m.index));
    last = m.index + m[0].length;
    const [, , headingId, heading, questionId, summary] = m;
    if (!headingId && !questionId) {
      // A </details>: it ends a question's answer; a plain <details> ends nothing.
      if (question && open) {
        open.end = text.length;
        open = undefined;
      }
      question = false;
      continue;
    }
    if (open) open.end = text.length;
    const title = add(headingId ? heading : summary);
    open = {
      id: headingId ?? questionId,
      title,
      start: text.length - title.length,
      end: text.length,
    };
    sections.push(open);
    question = !headingId;
  }
  add(html.slice(last));
  if (open) open.end = text.length;
  return { text, sections };
}

// Block elements separate words; inline ones (bold, a link, a code token) sit inside a sentence,
// and a space in their place would show up in search snippets as "for trade , for lend".
const BLOCK_TAG =
  /<\/?(?:address|article|aside|blockquote|br|dd|details|div|dl|dt|figcaption|figure|h[1-6]|hr|li|ol|p|pre|section|summary|table|tbody|td|tfoot|th|thead|tr|ul)\b[^>]*>/gi;

// Until stable: one pass can leave a tag behind when removing another forms it.
function stripTags(html: string): string {
  let text = html;
  for (let previous = ""; previous !== text;) {
    previous = text;
    text = text.replace(/<[^>]+>/g, "");
  }
  return text;
}

function stripHtml(html: string): string {
  return (
    stripTags(html.replace(BLOCK_TAG, " "))
      // The serializer writes & and < as hex references; this text is shown as text.
      .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
        String.fromCodePoint(parseInt(hex, 16)),
      )
      .replace(/\s+/g, " ")
      .trim()
  );
}
