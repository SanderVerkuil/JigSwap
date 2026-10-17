import { parseFragment } from "parse5";
import { beforeAll, describe, expect, it } from "vitest";
import {
  loadWhatsNewEntries,
  WhatsNewContentError,
  type WhatsNewSourceFile,
} from "./load";

// The first compile lazily loads Shiki's wasm + grammars (slow on a cold CI machine); warm once.
beforeAll(async () => {
  await loadWhatsNewEntries([file("2026-01-01-warmup.en.md")]);
}, 60000);

interface Fm {
  [key: string]: unknown;
}

const BASE: Fm = {
  id: "households",
  publishedAt: "2026-10-20",
  title: "Households",
  summary: "Share one shelf.",
  category: "feature",
};

// Build a source file; frontmatter values are emitted as YAML via JSON (valid YAML flow syntax),
// so a string date stays a string. `raw` frontmatter lines can be appended for YAML-native values.
function file(
  name: string,
  fm: Fm = {},
  body = "Body text.",
  rawLines: string[] = [],
): WhatsNewSourceFile {
  const [, date, slug] = /^(\d{4}-\d{2}-\d{2})-(.+?)\.(?:en|nl)\.md$/.exec(
    name,
  ) ?? [undefined, "2026-10-20", "x"];
  const merged: Fm = { ...BASE, id: slug, publishedAt: date, ...fm };
  const lines = Object.entries(merged)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`);
  return {
    name,
    raw: `---\n${[...lines, ...rawLines].join("\n")}\n---\n\n${body}\n`,
  };
}

async function problemsOf(files: WhatsNewSourceFile[]): Promise<string[]> {
  try {
    await loadWhatsNewEntries(files);
  } catch (error) {
    expect(error).toBeInstanceOf(WhatsNewContentError);
    return (error as WhatsNewContentError).problems;
  }
  throw new Error("expected loadWhatsNewEntries to reject");
}

type Node = {
  nodeName: string;
  attrs?: { name: string; value: string }[];
  childNodes?: Node[];
};

function elements(html: string, tag: string): Node[] {
  const found: Node[] = [];
  const walk = (node: Node) => {
    if (node.nodeName === tag) found.push(node);
    node.childNodes?.forEach(walk);
  };
  walk(parseFragment(html) as unknown as Node);
  return found;
}

const attr = (node: Node, name: string) =>
  node.attrs?.find((a) => a.name === name)?.value;

describe("loadWhatsNewEntries", () => {
  it("parses a valid entry with defaults", async () => {
    const { entries, warnings } = await loadWhatsNewEntries([
      file("2026-10-20-households.en.md"),
      file("2026-10-20-households.nl.md", {
        title: "Huishoudens",
        summary: "Deel één plank.",
      }),
    ]);
    expect(warnings).toEqual([]);
    expect(entries).toHaveLength(1);
    const [entry] = entries;
    expect(entry).toMatchObject({
      id: "households",
      publishedAt: Date.UTC(2026, 9, 20),
      category: "feature",
      highlight: false,
      notify: false,
    });
    expect(entry.tour).toBeUndefined();
    expect(entry.content.en).toMatchObject({
      title: "Households",
      summary: "Share one shelf.",
      fallback: false,
    });
    expect(entry.content.nl).toMatchObject({
      title: "Huishoudens",
      summary: "Deel één plank.",
      fallback: false,
    });
    expect(elements(entry.content.en.html, "p")).toHaveLength(1);
  });

  it("keeps optional fields", async () => {
    const { entries } = await loadWhatsNewEntries([
      file("2026-10-20-households.en.md", {
        highlight: true,
        notify: true,
        tour: "households-intro",
        image: "/whats-new/households.png",
        imageAlt: "A shared shelf",
        cta: { label: "Open household", to: "/household" },
      }),
    ]);
    expect(entries[0]).toMatchObject({
      highlight: true,
      notify: true,
      tour: "households-intro",
      image: "/whats-new/households.png",
      ctaTo: "/household",
    });
    expect(entries[0].content.en).toMatchObject({
      imageAlt: "A shared shelf",
      ctaLabel: "Open household",
    });
  });

  it("accepts a YAML-native date and an ISO datetime with offset", async () => {
    const { entries } = await loadWhatsNewEntries([
      file("2026-10-20-a.en.md", { publishedAt: undefined }, "x", [
        "publishedAt: 2026-10-20",
      ]),
      file("2026-10-21-b.en.md", { publishedAt: "2026-10-21T09:30:00+02:00" }),
    ]);
    expect(entries.map((e) => e.publishedAt)).toEqual([
      Date.parse("2026-10-21T07:30:00Z"),
      Date.UTC(2026, 9, 20),
    ]);
  });

  it("orders entries newest first, ties by id", async () => {
    const { entries } = await loadWhatsNewEntries([
      file("2026-10-01-old.en.md"),
      file("2026-10-20-zeta.en.md"),
      file("2026-10-20-alpha.en.md"),
    ]);
    expect(entries.map((e) => e.id)).toEqual(["alpha", "zeta", "old"]);
  });

  it("falls back to en when nl is missing, with a warning", async () => {
    const { entries, warnings } = await loadWhatsNewEntries([
      file("2026-10-20-households.en.md"),
    ]);
    expect(entries[0].content.nl).toEqual({
      ...entries[0].content.en,
      fallback: true,
    });
    expect(warnings).toEqual([
      "[whats-new] 2026-10-20-households: no nl translation, falling back to en",
    ]);
  });

  it("returns nothing for no files", async () => {
    expect(await loadWhatsNewEntries([])).toEqual({
      entries: [],
      warnings: [],
    });
  });

  it.each([
    ["a bad file name", "notes.md", {}, /notes\.md: file name must match/],
    [
      "an unknown locale",
      "2026-10-20-x.de.md",
      {},
      /2026-10-20-x\.de\.md: file name must match/,
    ],
    ["a missing title", "2026-10-20-x.en.md", { title: undefined }, /title/],
    ["an empty summary", "2026-10-20-x.en.md", { summary: " " }, /summary/],
    [
      "an unknown category",
      "2026-10-20-x.en.md",
      { category: "news" },
      /category/,
    ],
    [
      "an unknown key",
      "2026-10-20-x.en.md",
      { hightlight: true },
      /hightlight/,
    ],
    ["a non-kebab id", "2026-10-20-x.en.md", { id: "Bad_Id" }, /id/],
    [
      "an external cta",
      "2026-10-20-x.en.md",
      { cta: { label: "Go", to: "https://evil.example" } },
      /cta\.to/,
    ],
    [
      "a protocol-relative cta",
      "2026-10-20-x.en.md",
      { cta: { label: "Go", to: "//evil.example" } },
      /cta\.to/,
    ],
    [
      "an insecure image url",
      "2026-10-20-x.en.md",
      { image: "http://example.com/a.png" },
      /image/,
    ],
    [
      "imageAlt without image",
      "2026-10-20-x.en.md",
      { imageAlt: "alt" },
      /imageAlt/,
    ],
    [
      "a date that is not a date",
      "2026-10-20-x.en.md",
      { publishedAt: "soon" },
      /publishedAt/,
    ],
    [
      "a date that does not match the file name",
      "2026-10-20-x.en.md",
      { publishedAt: "2026-10-21" },
      /publishedAt .*2026-10-20/,
    ],
  ])("rejects %s", async (_label, name, fm, pattern) => {
    const problems = await problemsOf([file(name, fm)]);
    expect(problems.join("\n")).toMatch(pattern);
  });

  it("collects every problem before failing", async () => {
    const problems = await problemsOf([
      file("2026-10-20-a.en.md", { title: undefined }),
      file("2026-10-20-b.en.md", { category: "news" }),
    ]);
    expect(problems).toHaveLength(2);
  });

  it("rejects an nl file without its en sibling", async () => {
    const problems = await problemsOf([file("2026-10-20-x.nl.md")]);
    expect(problems.join("\n")).toMatch(/2026-10-20-x: missing en file/);
  });

  it("rejects locale-invariant fields that differ between en and nl", async () => {
    const problems = await problemsOf([
      file("2026-10-20-x.en.md", { highlight: true }),
      file("2026-10-20-x.nl.md", { highlight: false, category: "fix" }),
    ]);
    expect(problems.join("\n")).toMatch(
      /2026-10-20-x: nl differs from en in category, highlight/,
    );
  });

  it("rejects duplicate ids across entries", async () => {
    const problems = await problemsOf([
      file("2026-10-20-a.en.md", { id: "same" }),
      file("2026-10-21-b.en.md", { id: "same" }),
    ]);
    expect(problems.join("\n")).toMatch(/duplicate id "same"/);
  });
});

describe("whats-new markdown", () => {
  const render = async (body: string) =>
    (await loadWhatsNewEntries([file("2026-10-20-x.en.md", {}, body)]))
      .entries[0].content.en.html;

  it("demotes body headings below the card's h3", async () => {
    const html = await render("## Two\n\n### Three\n\n#### Four\n\n##### Five");
    expect(elements(html, "h2")).toHaveLength(0);
    expect(elements(html, "h3")).toHaveLength(0);
    expect(elements(html, "h4")).toHaveLength(1);
    expect(elements(html, "h5")).toHaveLength(1);
    expect(elements(html, "h6")).toHaveLength(2);
  });

  it("rejects an h1 in the body, in Markdown or raw HTML", async () => {
    for (const body of ["# Title", "<h1>Title</h1>"]) {
      const problems = await problemsOf([file("2026-10-20-x.en.md", {}, body)]);
      expect(problems.join("\n")).toMatch(/2026-10-20-x\.en\.md: .*h1/);
    }
  });

  it("opens external links in a new tab and leaves in-app links alone", async () => {
    const html = await render(
      "[docs](https://example.com) and [library](/library)",
    );
    const [external, internal] = elements(html, "a");
    expect(attr(external, "target")).toBe("_blank");
    expect(attr(external, "rel")).toBe("noopener noreferrer");
    expect(attr(internal, "target")).toBeUndefined();
  });

  it("highlights fenced code with Shiki (both themes)", async () => {
    const html = await render("```ts\nconst a = 1;\n```");
    const [pre] = elements(html, "pre");
    expect(attr(pre, "class")).toMatch(/shiki/);
    expect(attr(pre, "style")).toMatch(/--shiki-dark/);
  });
});
