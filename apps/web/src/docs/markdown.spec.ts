import { beforeAll, describe, expect, it } from "vitest";
import { compileMarkdown } from "./markdown";

// The first compileMarkdown call lazily loads Shiki's wasm + theme grammars,
// which can exceed the default 5s test timeout on a cold CI machine. Warm the
// shared processor once here (with a generous hook timeout) so individual tests
// only pay the fast incremental cost.
beforeAll(async () => {
  await compileMarkdown("# warmup\n");
}, 60000);

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

  it("passes a keywords list through for search", async () => {
    const r = await compileMarkdown(
      "---\ntitle: Lend\nkeywords:\n  - trade\n  - huisgenoot\n---\n\nBody.\n",
    );
    expect(r.frontmatter.keywords).toEqual(["trade", "huisgenoot"]);
    expect(r.html).not.toContain("trade");
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

  it("adds no spaces around inline markup in the plain text", async () => {
    const r = await compileMarkdown(
      'Mark it **for trade**, *for lend*, and/or `for sale`. "**Mara** asks (**now**)".\n\nNext block.',
    );
    expect(r.text).toBe(
      'Mark it for trade, for lend, and/or for sale. "Mara asks (now)". Next block.',
    );
  });

  it("writes & and < in the plain text as themselves", async () => {
    const r = await compileMarkdown("Privacy & safety: 1 < 2.");
    expect(r.text).toBe("Privacy & safety: 1 < 2.");
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

  it("recognizes a Dutch tone keyword as a callout", async () => {
    const r = await compileMarkdown("> **Let op:** wees voorzichtig.\n");
    expect(r.html).toContain('class="docs-callout"');
    expect(r.html).toContain('data-tone="info"');
  });

  it("passes through <details>/<summary> raw HTML with inner markdown rendered", async () => {
    const r = await compileMarkdown(
      "<details>\n<summary>Question?</summary>\n\nAn **answer** here.\n\n</details>\n",
    );
    expect(r.html).toContain("<details");
    expect(r.html).toContain("<summary>Question?</summary>");
    expect(r.html).toContain("<strong>answer</strong>");
  });

  // The router scrolls to an id on <details>, not to one inside its closed answer.
  it("ids each FAQ question's <details> from its question, in the page's language", async () => {
    const r = await compileMarkdown(
      '<details>\n<summary>Why is a photo blurred?</summary>\n\nThe check.\n\n</details>\n\n<details>\n<summary>Wat is het verschil tussen een "puzzel" en een "exemplaar"?</summary>\n\nEen exemplaar.\n\n</details>\n',
    );
    expect(r.html).toContain('<details id="why-is-a-photo-blurred">');
    expect(r.html).toContain(
      '<details id="wat-is-het-verschil-tussen-een-puzzel-en-een-exemplaar">',
    );
  });

  it("keeps a question's id clear of the headings' ids and of the other questions'", async () => {
    const r = await compileMarkdown(
      "## Blurred photos\n\n<details>\n<summary>Blurred photos</summary>\n\nA.\n\n</details>\n\n<details>\n<summary>Blurred photos</summary>\n\nB.\n\n</details>\n",
    );
    expect(r.html).toContain('<h2 id="blurred-photos">');
    expect(r.html).toContain('<details id="blurred-photos-1">');
    expect(r.html).toContain('<details id="blurred-photos-2">');
  });

  it("finds each section a search result can open at, FAQ questions under a heading included", async () => {
    const r = await compileMarkdown(
      "Intro.\n\n## Messages and photos\n\nAbout photos.\n\n<details>\n<summary>Why is a photo blurred?</summary>\n\nThe check was not sure.\n\n</details>\n\nAfter the question.\n\n### Sending\n\nSend **one**.\n",
    );
    expect(r.text).toBe(
      "Intro. Messages and photos About photos. Why is a photo blurred? The check was not sure. After the question. Sending Send one.",
    );
    expect(
      r.sections.map((s) => [s.id, s.title, r.text.slice(s.start, s.end)]),
    ).toEqual([
      [
        "messages-and-photos",
        "Messages and photos",
        "Messages and photos About photos.",
      ],
      [
        "why-is-a-photo-blurred",
        "Why is a photo blurred?",
        "Why is a photo blurred? The check was not sure.",
      ],
      ["sending", "Sending", "Sending Send one."],
    ]);
  });

  // A sub-step heading gets its own place to open at without growing the contents list.
  it("makes an h4 a search section with its level, but leaves it out of the TOC", async () => {
    const r = await compileMarkdown(
      "## Online status\n\nWho sees it.\n\n#### Set your status\n\nPick one.\n",
    );
    expect(r.headings.map((h) => h.id)).toEqual(["online-status"]);
    expect(
      r.sections.map((s) => [s.id, s.depth, r.text.slice(s.start, s.end)]),
    ).toEqual([
      ["online-status", 2, "Online status Who sees it."],
      ["set-your-status", 4, "Set your status Pick one."],
    ]);
  });

  // axe's heading-order: an h4 straight under an h2 skipped a level in a screen reader's list.
  it("makes a sub-step straight under an h2 an h3 that keeps its sub-step look and place", async () => {
    const r = await compileMarkdown(
      "## Online status\n\n#### Turn it on or off\n\nA.\n\n#### Who sees it\n\nB.\n\n## Read\n\n### Quick links\n\n#### In the header\n\nC.\n",
    );
    expect(
      Array.from(r.html.matchAll(/<(h[2-4])\b[^>]*>/g), (m) => m[0]),
    ).toEqual([
      '<h2 id="online-status">',
      '<h3 id="turn-it-on-or-off" class="docs-substep">',
      '<h3 id="who-sees-it" class="docs-substep">',
      '<h2 id="read">',
      '<h3 id="quick-links">',
      // Under an h3 an h4 is at its level already.
      '<h4 id="in-the-header">',
    ]);
    expect(r.headings.map((h) => h.id)).toEqual([
      "online-status",
      "read",
      "quick-links",
    ]);
    expect(r.sections.map((s) => [s.id, s.depth])).toEqual([
      ["online-status", 2],
      ["turn-it-on-or-off", 4],
      ["who-sees-it", 4],
      ["read", 2],
      ["quick-links", 3],
      ["in-the-header", 4],
    ]);
  });

  it("does not treat a deeply nested Note: as a callout", async () => {
    const r = await compileMarkdown(
      "> Regular quote.\n>\n> Then **Note:** later.\n",
    );
    expect(r.html).not.toContain("docs-callout");
  });

  it("opens external links in a new tab with a safe rel", async () => {
    const r = await compileMarkdown("[x](https://example.com)\n");
    expect(r.html).toContain('target="_blank"');
    expect(r.html).toMatch(/rel="[^"]*noopener/);
  });

  it("leaves internal links without a target", async () => {
    const r = await compileMarkdown("[home](/docs/foo)\n");
    expect(r.html).not.toContain('target="_blank"');
  });

  it("highlights fenced code blocks at build time", async () => {
    const r = await compileMarkdown("```ts\nconst x = 1;\n```\n");
    expect(r.html).toContain("<pre");
    expect(r.html).toMatch(/shiki|style="[^"]*color/);
  });
});
