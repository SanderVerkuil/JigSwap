import rehypeShiki from "@shikijs/rehype";
import type { Root } from "hast";
import rehypeExternalLinks from "rehype-external-links";
import rehypeRaw from "rehype-raw";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { visit } from "unist-util-visit";

// The entry card's title is an h3 (page h1 → month h2 → entry h3), so body headings move two
// levels down: h2 → h4, h3 → h5, anything deeper → h6. An h1 has no place in a body (the title
// comes from frontmatter), so it fails the build instead of being silently demoted.
const DEMOTED: Record<string, string> = {
  h2: "h4",
  h3: "h5",
  h4: "h6",
  h5: "h6",
  h6: "h6",
};
function demoteHeadings() {
  return (tree: Root) => {
    visit(tree, "element", (node) => {
      if (node.tagName === "h1") {
        throw new Error(
          "body must not contain an h1 heading (the title comes from frontmatter)",
        );
      }
      const demoted = DEMOTED[node.tagName];
      if (demoted) node.tagName = demoted;
    });
  };
}

// Same building blocks and options as the docs pipeline (src/docs/markdown.ts) so links and code
// render identically; no slugs, autolinked headings, TOC or callouts, which entries don't need.
// Content is trusted (repo-authored, build-time), hence raw HTML is allowed.
const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRaw)
  .use(rehypeExternalLinks, {
    target: "_blank",
    rel: ["noopener", "noreferrer"],
  })
  .use(demoteHeadings)
  .use(rehypeShiki, {
    themes: { light: "github-light", dark: "github-dark" },
  })
  .use(rehypeStringify);

export async function compileWhatsNewBody(markdown: string): Promise<string> {
  return String(await processor.process(markdown));
}
