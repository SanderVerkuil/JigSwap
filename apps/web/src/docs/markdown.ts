import matter from "gray-matter";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import type { DocFrontmatter, DocHeading } from "./types";

// Collect h2/h3 headings (with the ids rehype-slug assigns) for the on-page TOC.
function collectHeadings() {
  return (tree: any, file: any) => {
    const headings: DocHeading[] = [];
    visit(tree, "element", (node: any) => {
      if (node.tagName === "h2" || node.tagName === "h3") {
        const text = toText(node);
        headings.push({
          id: node.properties?.id ?? "",
          text,
          depth: node.tagName === "h2" ? 2 : 3,
        });
      }
    });
    file.data.headings = headings;
  };
}

// Strip the first/leading H1 from the rendered body so each page has exactly one
// H1 (the route injects its own from frontmatter). The stripped H1's text is
// exposed on `file.data.title` as a fallback page title.
function stripLeadingH1() {
  return (tree: any, file: any) => {
    if (!tree.children) return;
    // Only the genuinely leading heading: the first top-level *element* must be
    // an h1. A mid-page h1 the author wrote intentionally is left untouched.
    const index = tree.children.findIndex(
      (node: any) => node.type === "element",
    );
    if (index === -1) return;
    const first = tree.children[index];
    if (first.tagName !== "h1") return;
    tree.children.splice(index, 1);
    file.data.title = toText(first).trim();
  };
}

// Turn `> **Note:** ...` blockquotes into branded callouts. The first strong
// child whose text matches a known tone keyword selects the tone.
const TONES: Record<string, string> = {
  note: "info",
  info: "info",
  tip: "tip",
  warning: "warning",
  caution: "warning",
  danger: "danger",
  important: "danger",
};
function calloutsFromBlockquotes() {
  return (tree: any) => {
    visit(tree, "element", (node: any) => {
      if (node.tagName !== "blockquote") return;
      // Only treat as a callout when the blockquote's first paragraph *leads*
      // with a tone keyword in bold (e.g. `> **Note:** ...`). This avoids
      // reclassifying ordinary quotes that merely contain bold text deeper in.
      const firstPara = (node.children ?? []).find(
        (c: any) => c.type === "element" && c.tagName === "p",
      );
      const leadStrong = (firstPara?.children ?? []).find(
        (c: any) => c.type === "element" && c.tagName === "strong",
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

function toText(node: any): string {
  if (node.type === "text") return node.value;
  if (!node.children) return "";
  return node.children.map(toText).join("");
}

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype)
  .use(rehypeSlug)
  .use(rehypeAutolinkHeadings, { behavior: "wrap" })
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
  return {
    frontmatter: data as DocFrontmatter,
    html,
    headings: (file.data.headings as DocHeading[]) ?? [],
    text: stripHtml(html),
    title: file.data.title as string | undefined,
  };
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
