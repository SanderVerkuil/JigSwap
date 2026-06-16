import { describe, expect, it } from "vitest";
import { compileMarkdown } from "./markdown";

const SRC = `---
title: Demo Page
order: 2
summary: A demo.
---

# Demo Page

Intro paragraph.

## First Section

Some text with \`code\`.

### Nested

> **Note:** be careful.
`;

describe("compileMarkdown", () => {
  it("parses frontmatter", async () => {
    const r = await compileMarkdown(SRC);
    expect(r.frontmatter).toEqual({
      title: "Demo Page",
      order: 2,
      summary: "A demo.",
    });
  });

  it("emits stable heading ids for h2/h3 in the TOC", async () => {
    const r = await compileMarkdown(SRC);
    expect(r.headings).toEqual([
      { id: "first-section", text: "First Section", depth: 2 },
      { id: "nested", text: "Nested", depth: 3 },
    ]);
    expect(r.html).toContain('id="first-section"');
  });

  it("renders a Note blockquote as an info callout", async () => {
    const r = await compileMarkdown(SRC);
    expect(r.html).toContain('class="docs-callout"');
    expect(r.html).toContain('data-tone="info"');
  });

  it("produces plain text for search", async () => {
    const r = await compileMarkdown(SRC);
    expect(r.text).toContain("Intro paragraph");
    expect(r.text).not.toContain("<");
  });

  it("strips the leading H1 from the rendered body and exposes it as title", async () => {
    const r = await compileMarkdown("# Page Title\n\nBody.\n\n## Section\n");
    expect(r.html).not.toContain("<h1");
    expect(r.title).toBe("Page Title");
  });

  it("keeps a non-leading H1 (only the leading one is stripped)", async () => {
    const r = await compileMarkdown("## First\n\n# Later\n");
    expect(r.html).toContain("Later");
    expect(r.title).toBeUndefined();
  });

  it("leaves an ordinary blockquote as a blockquote", async () => {
    const r = await compileMarkdown("> Just a quote with **bold** inside.\n");
    expect(r.html).toContain("<blockquote");
    expect(r.html).not.toContain("docs-callout");
  });

  it("does not treat a deeply nested Note: as a callout", async () => {
    const r = await compileMarkdown(
      "> Regular quote.\n>\n> Then **Note:** later.\n",
    );
    expect(r.html).not.toContain("docs-callout");
  });

  it("highlights fenced code blocks at build time", async () => {
    const r = await compileMarkdown("```ts\nconst x = 1;\n```\n");
    expect(r.html).toContain("<pre");
    expect(r.html).toMatch(/shiki|style="[^"]*color/);
  });
});
