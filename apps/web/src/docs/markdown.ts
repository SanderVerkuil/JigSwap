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
import type { DocFrontmatter, DocHeading } from "./types";

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
      node.properties = { className: "docs-callout", "data-tone": tone };
    });
  };
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
    text: stripHtml(html),
    title: docData.title,
  };
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
