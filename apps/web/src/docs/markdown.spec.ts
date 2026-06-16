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
});
