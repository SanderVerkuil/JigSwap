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
    const index = tree.children.findIndex(
      (node: any) => node.type === "element" && node.tagName === "h1",
    );
    if (index === -1) return;
    const [removed] = tree.children.splice(index, 1);
    file.data.title = toText(removed).trim();
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
      const firstStrong = findFirstStrongText(node);
      const key = firstStrong?.replace(/:$/, "").trim().toLowerCase();
      const tone = key ? TONES[key] : undefined;
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
function findFirstStrongText(node: any): string | undefined {
  let found: string | undefined;
  visit(node, "element", (n: any) => {
    if (!found && n.tagName === "strong") found = toText(n);
  });
  return found;
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
