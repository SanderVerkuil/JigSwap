import { describe, expect, it, vi } from "vitest";
import { Route } from "./sitemap[.]xml";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
}));

// One catalogue definition, and nothing more to page through.
vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    query = async () => ({
      page: [{ id: "def1", updatedAt: Date.UTC(2026, 9, 1) }],
      isDone: true,
      continueCursor: "",
    });
  },
}));

vi.mock("virtual:docs", () => ({
  pages: [
    { locale: "en", slug: "help", isIndex: true },
    { locale: "en", slug: "help/faq-and-troubleshooting", isIndex: false },
    { locale: "nl", slug: "help/faq-and-troubleshooting", isIndex: false },
  ],
}));

type Get = (ctx: { request: Request }) => Promise<Response>;
const { GET } = (
  Route as unknown as { options: { server: { handlers: { GET: Get } } } }
).options.server.handlers;

// Crawlers found the English docs only through the header and sidebar links.
describe("/sitemap.xml", () => {
  it("lists the docs landing and the articles from the docs page list, with the catalogue", async () => {
    const res = await GET({
      request: new Request("https://jigswap.site/sitemap.xml"),
    });

    const locs = [...(await res.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map(
      ([, loc]) => loc,
    );
    expect(locs).toEqual([
      "https://jigswap.site/catalog",
      "https://jigswap.site/docs",
      "https://jigswap.site/docs/help/faq-and-troubleshooting",
      "https://jigswap.site/catalog/def1",
    ]);
  });
});
