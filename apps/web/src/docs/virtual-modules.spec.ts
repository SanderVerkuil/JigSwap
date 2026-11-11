import { describe, expect, it } from "vitest";
import type { CompiledDoc } from "./markdown";
import type { DocPage } from "./types";
import {
  docPageFromFile,
  isDocsModule,
  renderDocsModule,
} from "./virtual-modules";

function compiled(title: string): CompiledDoc {
  return {
    frontmatter: { title },
    html: `<p>${title} html</p>`,
    headings: [{ id: "intro", text: `${title} intro`, depth: 2 }],
    text: `${title} text`,
    sections: [{ id: "intro", title, start: 0, end: `${title} text`.length }],
  };
}

const PAGES: DocPage[] = [
  docPageFromFile("en/index.md", compiled("User guide")),
  docPageFromFile("en/getting-started/index.md", compiled("Getting started")),
  docPageFromFile("en/getting-started/dashboard.md", compiled("Dashboard")),
  docPageFromFile("en/help/faq.md", compiled("FAQ")),
  docPageFromFile("nl/getting-started/dashboard.md", compiled("Overzicht")),
];

// Runs a generated module the way the bundler would, minus the bundler.
async function evaluate(id: string): Promise<Record<string, unknown>> {
  const source = renderDocsModule(id, PAGES);
  if (source === null) throw new Error(`no module for ${id}`);
  const url = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
  return (await import(/* @vite-ignore */ url)) as Record<string, unknown>;
}

describe("docPageFromFile", () => {
  it("derives locale, slug, group and id from the path", () => {
    expect(
      PAGES.map(({ id, locale, slug, group, isIndex }) => ({
        id,
        locale,
        slug,
        group,
        isIndex,
      })),
    ).toEqual([
      { id: "en/index", locale: "en", slug: "", group: "", isIndex: true },
      {
        id: "en/getting-started/index",
        locale: "en",
        slug: "getting-started",
        group: "getting-started",
        isIndex: true,
      },
      {
        id: "en/getting-started/dashboard",
        locale: "en",
        slug: "getting-started/dashboard",
        group: "getting-started",
        isIndex: false,
      },
      {
        id: "en/help/faq",
        locale: "en",
        slug: "help/faq",
        group: "help",
        isIndex: false,
      },
      {
        id: "nl/getting-started/dashboard",
        locale: "nl",
        slug: "getting-started/dashboard",
        group: "getting-started",
        isIndex: false,
      },
    ]);
  });
});

describe("renderDocsModule", () => {
  it("serves only page metadata from virtual:docs", async () => {
    const { pages } = await evaluate("virtual:docs");
    expect(pages).toEqual(
      PAGES.map(({ id, locale, slug, group, isIndex, frontmatter }) => ({
        id,
        locale,
        slug,
        group,
        isIndex,
        frontmatter,
      })),
    );
  });

  it("has a content loader for every page, each pointing at that page's module", async () => {
    const { pageLoaders } = await evaluate("virtual:docs/content");
    expect(Object.keys(pageLoaders as object)).toEqual(PAGES.map((p) => p.id));
    const source = renderDocsModule("virtual:docs/content", PAGES);
    for (const page of PAGES) {
      expect(source).toContain(`import("virtual:docs/page/${page.id}")`);
      expect(
        renderDocsModule(`virtual:docs/page/${page.id}`, PAGES),
      ).not.toBeNull();
    }
  });

  it("serves one page's html and headings from its page module", async () => {
    const mod = await evaluate(
      "virtual:docs/page/en/getting-started/dashboard",
    );
    expect({ ...mod }).toEqual({
      html: "<p>Dashboard html</p>",
      headings: [{ id: "intro", text: "Dashboard intro", depth: 2 }],
    });
  });

  it("has a search loader per locale", async () => {
    const { searchLoaders } = await evaluate("virtual:docs/search");
    expect(Object.keys(searchLoaders as object)).toEqual(["en", "nl"]);
    const source = renderDocsModule("virtual:docs/search", PAGES);
    expect(source).toContain(`import("virtual:docs/search/en")`);
    expect(source).toContain(`import("virtual:docs/search/nl")`);
  });

  it("builds a locale's search corpus from its leaf pages, falling back to en", async () => {
    const { docs } = await evaluate("virtual:docs/search/nl");
    expect(docs).toEqual([
      {
        id: "getting-started/dashboard",
        slug: "getting-started/dashboard",
        title: "Overzicht",
        group: "getting-started",
        summary: "",
        keywords: "",
        headings: "Overzicht",
        text: "Overzicht text",
        sections: [{ id: "intro", title: "Overzicht", start: 0, end: 14 }],
      },
      {
        id: "help/faq",
        slug: "help/faq",
        title: "FAQ",
        group: "help",
        summary: "",
        keywords: "",
        headings: "FAQ",
        text: "FAQ text",
        sections: [{ id: "intro", title: "FAQ", start: 0, end: 8 }],
      },
    ]);
  });

  it("returns null for unknown pages, locales and modules", () => {
    expect(renderDocsModule("virtual:docs/page/en/nope", PAGES)).toBeNull();
    expect(renderDocsModule("virtual:docs/search/fr", PAGES)).toBeNull();
    expect(renderDocsModule("virtual:docs/other", PAGES)).toBeNull();
  });
});

describe("isDocsModule", () => {
  it("claims virtual:docs and its sub-modules only", () => {
    expect(isDocsModule("virtual:docs")).toBe(true);
    expect(isDocsModule("virtual:docs/page/en/index")).toBe(true);
    expect(isDocsModule("virtual:docsy")).toBe(false);
    expect(isDocsModule("virtual:whats-new")).toBe(false);
  });
});
