// @vitest-environment happy-dom
import { DocsSearchProvider } from "@/components/docs/docs-search-context";
import type { DocMeta, DocPage } from "@/docs/types";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ComponentProps, ComponentType } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../../locales/en.json";
import nl from "../../../../locales/nl.json";
import { Route as DocPageRoute } from "./$";
import { Route as DocsIndexRoute } from "./index";

const NOT_FOUND = vi.hoisted(() => ({ isNotFound: true }));
const loaderData = vi.hoisted(() => ({ current: undefined as unknown }));
const location = vi.hoisted(() => ({ hash: "" }));

// The head reads the strings from the loaded catalog of the context's locale.
vi.mock("@/lib/i18n-catalog", () => ({
  messagesFor: (locale: string) => (locale === "nl" ? nl : en),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { component: ComponentType }) => ({
    options,
    useLoaderData: () => loaderData.current,
  }),
  notFound: () => NOT_FOUND,
  useLocation: (opts?: { select?: (l: typeof location) => unknown }) =>
    opts?.select ? opts.select(location) : location,
  Link: ({
    to,
    params: _params,
    activeOptions,
    children,
    ...rest
  }: ComponentProps<"a"> & {
    to: string;
    params?: object;
    activeOptions?: { exact?: boolean };
  }) => (
    <a href={to} data-exact={activeOptions?.exact ? "" : undefined} {...rest}>
      {children}
    </a>
  ),
}));

// Its feedback mutation needs a Convex client, and it plays no part in what's tested here.
vi.mock("@/components/docs/doc-helpful", () => ({ DocHelpful: () => null }));

vi.mock("virtual:docs", () => {
  const page = (
    locale: string,
    slug: string,
    group: string,
    title: string,
    extra: Partial<DocPage> = {},
  ): DocPage => ({
    id: `${locale}/${slug}${extra.isIndex ? "/index" : ""}`,
    locale,
    slug,
    group,
    isIndex: false,
    frontmatter: { title, summary: `${title} summary` },
    html: `<p>${title}</p>`,
    headings: [],
    text: title,
    sections: [],
    ...extra,
  });
  return {
    pages: [
      page("en", "getting-started", "getting-started", "Getting started", {
        isIndex: true,
      }),
      page("en", "getting-started/first", "getting-started", "First steps", {
        frontmatter: { title: "First steps", summary: "Begin here", order: 1 },
        headings: [{ id: "one", text: "One", depth: 2 }],
      }),
      page("en", "getting-started/next", "getting-started", "Next steps", {
        frontmatter: { title: "Next steps", order: 2 },
      }),
      page("en", "your-library", "your-library", "Your library", {
        isIndex: true,
      }),
      page("en", "your-library/shelf", "your-library", "Your shelf"),
      page("nl", "getting-started/first", "getting-started", "Eerste stappen", {
        frontmatter: { title: "Eerste stappen", summary: "Begin hier" },
      }),
    ],
  };
});

vi.mock("virtual:docs/content", async () => {
  const { pages } = (await import("virtual:docs")) as unknown as {
    pages: DocPage[];
  };
  return {
    pageLoaders: Object.fromEntries(
      pages.map(({ id, html, headings }) => [
        id,
        async () => ({ html, headings }),
      ]),
    ),
  };
});

type DocLoaderData = {
  page: Pick<DocMeta, "frontmatter">;
  html: string;
  headings: unknown[];
};
type Options = {
  component: ComponentType;
  head: (ctx: {
    loaderData?: Pick<DocLoaderData, "page">;
    match: { context: unknown; pathname: string };
  }) => { meta: Array<Record<string, string>> };
  loader: (ctx: {
    params: { _splat: string };
    context: { intl: { locale: string } };
  }) => Promise<DocLoaderData>;
};
const docPage = (DocPageRoute as unknown as { options: Options }).options;
const DocsIndex = (DocsIndexRoute as unknown as { options: Options }).options
  .component;

const withIntl = (children: React.ReactNode, locale: "en" | "nl" = "en") => (
  <IntlProvider
    locale={locale}
    messages={locale === "nl" ? nl : en}
    timeZone="Europe/Amsterdam"
  >
    {children}
  </IntlProvider>
);

const headMatch = (locale: "en" | "nl") => ({
  context: {
    intl: {
      locale,
      timeZone: "Europe/Amsterdam",
      now: 0,
    },
  },
  pathname: "/docs/getting-started/first",
});

afterEach(cleanup);

describe("docs page loader", () => {
  it("answers an unknown slug with a real 404", async () => {
    await expect(
      docPage.loader({
        params: { _splat: "nope/nope" },
        context: { intl: { locale: "en" } },
      }),
    ).rejects.toBe(NOT_FOUND);
  });

  it("hands the head the page's own title and summary, in the visitor's language", async () => {
    const { page } = await docPage.loader({
      params: { _splat: "getting-started/first" },
      context: { intl: { locale: "nl" } },
    });
    expect(page.frontmatter).toEqual({
      title: "Eerste stappen",
      summary: "Begin hier",
    });
  });

  it("loads that page's own body, in the visitor's language", async () => {
    const { html } = await docPage.loader({
      params: { _splat: "getting-started/first" },
      context: { intl: { locale: "nl" } },
    });
    expect(html).toBe("<p>Eerste stappen</p>");
  });
});

describe("docs page head", () => {
  it("titles and describes the page from its frontmatter", () => {
    const { meta } = docPage.head({
      loaderData: {
        page: { frontmatter: { title: "First steps", summary: "Begin here" } },
      },
      match: headMatch("en"),
    });
    expect(meta).toContainEqual({ title: "First steps — JigSwap" });
    expect(meta).toContainEqual({ name: "description", content: "Begin here" });
    expect(meta).toContainEqual({
      property: "og:title",
      content: "First steps — JigSwap",
    });
  });

  it("titles the 404 as a missing page in the visitor's language", () => {
    const { meta } = docPage.head({ match: headMatch("nl") });
    expect(meta).toEqual([{ title: nl.marketing.titles.notFound }]);
  });
});

describe("docs page landmarks", () => {
  beforeEach(async () => {
    loaderData.current = await docPage.loader({
      params: { _splat: "getting-started/first" },
      context: { intl: { locale: "en" } },
    });
  });

  it("names the pager and the on-page contents so screen readers can tell them apart", () => {
    render(withIntl(<docPage.component />));

    const pager = screen.getByRole("navigation", {
      name: "Previous and next page",
    });
    expect(within(pager).getByText("Next steps")).toBeTruthy();

    const toc = screen.getByRole("complementary", { name: "On this page" });
    expect(
      within(toc).getByRole("navigation", { name: "On this page" }),
    ).toBeTruthy();
    expect(within(toc).getByRole("link", { name: "One" })).toBeTruthy();
  });

  it("starts at one h1, the page's own title", () => {
    render(withIntl(<docPage.component />));
    expect(
      screen
        .getAllByRole("heading", { level: 1 })
        .map((heading) => heading.textContent),
    ).toEqual(["First steps"]);
  });

  // F20: below 1280px the rail is hidden, so the same list folds in under the title, where the
  // phone Docs bar jumps back to it.
  it("folds the on-page contents in under the title where the rail doesn't fit", () => {
    const { container } = render(withIntl(<docPage.component />));
    const details = container.querySelector("details#on-this-page");
    expect(details).not.toBeNull();
    expect(details?.className).toContain("min-[1280px]:hidden");
    expect(details?.querySelector("summary")?.textContent).toBe("On this page");
    expect(
      within(details as HTMLElement)
        .getAllByRole("link")
        .map((a) => a.getAttribute("href")),
    ).toEqual(["#one"]);
    const h1 = screen.getByRole("heading", { level: 1 });
    const prose = container.querySelector(".docs-prose") as Element;
    expect(
      h1.compareDocumentPosition(details as Element) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      (details as Element).compareDocumentPosition(prose) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  // As on the legal pages: the rail sits on the white page, the folded block is Sky Soft, and
  // each marks its current entry so it stands off its own ground.
  it("marks the current entry with a Sky Soft pill in the rail and a white window in the fold", async () => {
    const { container } = render(withIntl(<docPage.component />));
    const details = container.querySelector(
      "details#on-this-page",
    ) as HTMLElement;
    expect(details.className).toContain("bg-mk-sky-soft");
    const rail = screen.getByRole("complementary", { name: "On this page" });
    const railCurrent = within(rail).getByRole("link", { name: "One" });
    const foldCurrent = within(details).getByRole("link", { name: "One" });
    // happy-dom has no layout, so every top is 0 and the last heading is the current one.
    await waitFor(() =>
      expect(railCurrent.getAttribute("aria-current")).toBe("true"),
    );
    expect(foldCurrent.getAttribute("aria-current")).toBe("true");
    expect(railCurrent.className).toContain("bg-mk-sky-soft");
    expect(foldCurrent.className).toContain("bg-mk-card");
    expect(foldCurrent.className).not.toContain("bg-mk-sky-soft");
  });
});

// A search result can open a page at a FAQ question; the router navigates with pushState, which
// leaves a <details> closed.
describe("docs page opens the FAQ question in the hash", () => {
  const FAQ_HTML =
    '<details id="why-is-a-photo-blurred"><summary>Why is a photo blurred?</summary><p>The check.</p></details>';
  const firstPage = () =>
    docPage.loader({
      params: { _splat: "getting-started/first" },
      context: { intl: { locale: "en" } },
    });
  const question = (container: HTMLElement) =>
    container.querySelector(
      "details#why-is-a-photo-blurred",
    ) as HTMLDetailsElement;

  afterEach(() => {
    location.hash = "";
    vi.restoreAllMocks();
  });

  it("opens the question and lands on it", async () => {
    loaderData.current = { ...(await firstPage()), html: FAQ_HTML };
    location.hash = "why-is-a-photo-blurred";
    const scrollIntoView = vi
      .spyOn(Element.prototype, "scrollIntoView")
      .mockImplementation(() => {});
    const { container } = render(withIntl(<docPage.component />));
    expect(question(container).open).toBe(true);
    expect(scrollIntoView.mock.contexts).toEqual([question(container)]);
  });

  // The router sets the new hash while the last page still shows.
  it("opens it once the new page's body is in", async () => {
    const before = await firstPage();
    loaderData.current = before;
    location.hash = "why-is-a-photo-blurred";
    const { container, rerender } = render(withIntl(<docPage.component />));
    loaderData.current = { ...before, html: FAQ_HTML };
    rerender(withIntl(<docPage.component />));
    expect(question(container).open).toBe(true);
  });

  it("leaves the folded On this page block to its own link", async () => {
    loaderData.current = await firstPage();
    location.hash = "on-this-page";
    const { container } = render(withIntl(<docPage.component />));
    const contents = container.querySelector(
      "details#on-this-page",
    ) as HTMLDetailsElement;
    expect(contents.open).toBe(false);
  });
});

// F19: every crumb used to carry aria-current, and a group's index page listed its group twice.
describe("docs breadcrumb", () => {
  const crumbs = () =>
    within(screen.getByRole("navigation", { name: "Breadcrumb" }));

  it("marks only the page itself as current, and links its group", async () => {
    loaderData.current = await docPage.loader({
      params: { _splat: "getting-started/first" },
      context: { intl: { locale: "en" } },
    });
    render(withIntl(<docPage.component />));
    const nav = screen.getByRole("navigation", { name: "Breadcrumb" });

    const current = nav.querySelectorAll("[aria-current]");
    expect(current).toHaveLength(1);
    expect(current[0].textContent).toBe("First steps");
    expect(current[0].getAttribute("aria-current")).toBe("page");

    const links = crumbs().getAllByRole("link");
    expect(links.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Docs", "/docs"],
      ["Getting started", "/docs/getting-started"],
    ]);
    // TanStack would otherwise mark them current on every page below them.
    for (const link of links)
      expect(link.hasAttribute("data-exact")).toBe(true);
  });

  it("leaves the group out on the group's own index page", async () => {
    loaderData.current = await docPage.loader({
      params: { _splat: "getting-started" },
      context: { intl: { locale: "en" } },
    });
    render(withIntl(<docPage.component />));
    const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(Array.from(nav.children, (crumb) => crumb.textContent)).toEqual([
      "Docs",
      "Getting started",
    ]);
    expect(nav.querySelector("[aria-current]")?.textContent).toBe(
      "Getting started",
    );
  });
});

describe("docs landing", () => {
  it("has its topics at h2 under the h1, with no h3 jump", () => {
    render(withIntl(<DocsIndex />));
    const levels = screen
      .getAllByRole("heading")
      .map((heading) => heading.tagName);
    expect(levels[0]).toBe("H1");
    expect(levels).not.toContain("H3");
    expect(
      screen.getByRole("heading", { level: 2, name: "Getting started" }),
    ).toBeTruthy();
  });

  // F17: inline links were 21px targets on touch screens.
  it("gives each article link a 44px row on touch screens", () => {
    render(withIntl(<DocsIndex />));
    const link = screen.getByRole("link", { name: "First steps" });
    expect(link.className).toContain("pointer-coarse:min-h-11");
    expect(link.className).toContain("inline-flex");
    expect(link.closest("ul")?.className).toContain("pointer-coarse:gap-0");
  });

  it("gives each topic its own icon", () => {
    render(withIntl(<DocsIndex />));
    const iconOf = (name: string) =>
      screen
        .getByRole("heading", { level: 2, name })
        .closest("a")
        ?.querySelector("svg")
        ?.getAttribute("class");
    expect(iconOf("Getting started")).toContain("lucide-rocket");
    expect(iconOf("Your library")).toContain("lucide-book-open");
  });

  it("offers search in the hero, which opens the layout's dialog", () => {
    const openSearch = vi.fn();
    render(
      withIntl(
        <DocsSearchProvider value={openSearch}>
          <DocsIndex />
        </DocsSearchProvider>,
      ),
    );

    const search = screen.getByRole("button", {
      name: en.marketing.docs.searchTrigger,
    });
    expect(search.getAttribute("aria-haspopup")).toBe("dialog");
    fireEvent.click(search);
    expect(openSearch).toHaveBeenCalledOnce();
  });

  // UX-158: the same hint as the sidebar pill, not a Mac glyph on every platform.
  it.each([
    ["MacIntel", "⌘K"],
    ["Linux x86_64", "Ctrl K"],
    ["Win32", "Ctrl K"],
  ])("names the %s shortcut in the hero search as %s", (platform, hint) => {
    vi.stubGlobal("navigator", {
      ...navigator,
      platform,
      userAgentData: undefined,
    });
    render(
      withIntl(
        <DocsSearchProvider value={vi.fn()}>
          <DocsIndex />
        </DocsSearchProvider>,
      ),
    );
    const kbd = screen
      .getByRole("button", { name: en.marketing.docs.searchTrigger })
      .querySelector("kbd");
    expect(kbd?.textContent).toBe(hint);
    expect(kbd?.className).toContain("pointer-coarse:hidden");
    expect(kbd?.className).toContain("text-mk-text-body");
    vi.unstubAllGlobals();
  });

  it("speaks the visitor's language in the hero search", () => {
    render(
      withIntl(
        <DocsSearchProvider value={vi.fn()}>
          <DocsIndex />
        </DocsSearchProvider>,
        "nl",
      ),
    );
    expect(
      screen.getByRole("button", { name: nl.marketing.docs.searchTrigger }),
    ).toBeTruthy();
  });
});
