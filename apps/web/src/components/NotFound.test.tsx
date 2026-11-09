// @vitest-environment happy-dom
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../locales/en.json";
import nl from "../../locales/nl.json";
import { PageHead } from "./dashboard-layout/page-head";
import { PageHeaderSlotProvider } from "./dashboard-layout/page-header-slot";
import { ShellHeading } from "./dashboard-layout/shell-title";
import {
  AppNotFound,
  MarketingNotFound,
  NotFound,
  ShellNotFound,
} from "./NotFound";

const mocks = vi.hoisted(() => ({ pathname: "/dashboard/no-such-page" }));

// The page head reads the path for its route meta, and greets the member on /dashboard paths.
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useLocation: (opts?: {
    select?: (location: { pathname: string }) => unknown;
  }) => {
    const location = { pathname: mocks.pathname };
    return opts?.select ? opts.select(location) : location;
  },
}));
vi.mock("@/compat/clerk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/compat/clerk")>()),
  useUser: () => ({ user: { firstName: "Henk" } }),
}));

vi.mock("@/compat/link", () => ({
  Link: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children?: ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// The marketing chrome needs the router and Convex auth; stand-ins are enough to see it framed.
vi.mock("@/components/marketing/header", () => ({
  MarketingHeader: () => <header>marketing header</header>,
}));
vi.mock("@/components/marketing/footer", () => ({
  MarketingFooter: () => <footer>marketing footer</footer>,
}));

const renderIn = (node: ReactNode, locale: "en" | "nl" = "en") =>
  render(
    <IntlProvider
      locale={locale}
      messages={locale === "en" ? en : nl}
      timeZone="Europe/Amsterdam"
    >
      {node}
    </IntlProvider>,
  );

const hrefs = (root: HTMLElement) =>
  within(root)
    .getAllByRole("link")
    .map((a) => a.getAttribute("href"));

afterEach(cleanup);

describe("MarketingNotFound", () => {
  it("is a page with one main landmark and an h1", () => {
    renderIn(<MarketingNotFound />);
    const main = screen.getByRole("main");
    expect(
      within(main).getByRole("heading", { level: 1, name: "Page not found" }),
    ).toBeTruthy();
  });

  it("sends visitors to public pages, never the members-only /browse", () => {
    renderIn(<MarketingNotFound />);
    const links = hrefs(screen.getByRole("main"));
    expect(links).toEqual(
      expect.arrayContaining(["/", "/catalog", "/docs", "/contact"]),
    );
    expect(links).not.toContain("/browse");
  });

  it("uses Dutch sentence case", () => {
    renderIn(<MarketingNotFound />, "nl");
    expect(
      screen.getByRole("heading", { level: 1, name: "Pagina niet gevonden" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Bekijk de catalogus" }),
    ).toBeTruthy();
  });

  // F06: the public pages share one large action, the one the home page uses.
  it("offers its two ways back as public actions", () => {
    renderIn(<MarketingNotFound />);
    for (const name of [en.notFound.backToHome, en.notFound.browseCatalogue]) {
      const classes = screen.getByRole("link", { name }).className.split(/\s+/);
      expect(classes).toEqual(
        expect.arrayContaining(["h-[50px]", "rounded-[10px]", "text-[18px]"]),
      );
      expect(classes).not.toContain("h-11");
    }
  });
});

describe("root NotFound", () => {
  it("frames the not-found page in the marketing header and footer", () => {
    renderIn(<NotFound />);
    expect(screen.getByText("marketing header")).toBeTruthy();
    expect(screen.getByText("marketing footer")).toBeTruthy();
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
  });
});

// The not-found in the shell, under the desktop page head as it renders there.
const renderInShell = (
  node: ReactNode,
  pathname = "/dashboard/no-such-page",
) => {
  mocks.pathname = pathname;
  return renderIn(
    <PageHeaderSlotProvider>
      <PageHead />
      <main>{node}</main>
    </PageHeaderSlotProvider>,
  );
};

const pageHead = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('[data-slot="page-head"]')!;

describe("AppNotFound", () => {
  it("keeps the in-app actions", () => {
    const { container } = renderIn(<AppNotFound />);
    expect(hrefs(container)).toEqual(["/dashboard", "/browse"]);
  });

  // F68: the head said "Welcome back, Henk!" over a second, display-size "Page not found" h1.
  it("titles the page head 'Page not found' instead of the greeting, with no h1 of its own", () => {
    const { container } = renderInShell(<AppNotFound />);
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0].textContent).toBe("Page not found");
    expect(pageHead(container).contains(headings[0])).toBe(true);
    expect(screen.queryByText(/Henk/)).toBeNull();
    expect(within(screen.getByRole("main")).queryByRole("heading")).toBeNull();
  });

  it("names no place in the app above it", () => {
    renderInShell(<AppNotFound />, "/circles/circle_1");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Page not found",
    );
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("explains at the app's body size", () => {
    renderInShell(<AppNotFound />);
    const line = screen.getByText(en.notFound.description);
    expect(line.className).toMatch(/\btext-sm\b/);
    expect(line.className).toContain("text-muted-foreground");
  });

  it("titles the head in Dutch too", () => {
    mocks.pathname = "/dashboard/no-such-page";
    render(
      <IntlProvider locale="nl" messages={nl} timeZone="Europe/Amsterdam">
        <PageHeaderSlotProvider>
          <PageHead />
          <AppNotFound />
        </PageHeaderSlotProvider>
      </IntlProvider>,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Pagina niet gevonden",
    );
  });
});

describe("ShellNotFound", () => {
  it("offers the way back it is given", () => {
    renderInShell(
      <ShellNotFound
        title="Collection not found"
        description="It may have been deleted."
        backHref="/collections"
        backLabel="Back to collections"
      />,
    );
    const back = screen.getByRole("link", { name: "Back to collections" });
    expect(back.getAttribute("href")).toBe("/collections");
    expect(screen.getByText("It may have been deleted.")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Collection not found",
    );
  });

  it("renders the given actions instead of the back link", () => {
    renderInShell(
      <ShellNotFound
        title="Gone"
        backHref="/collections"
        backLabel="Back to collections"
        actions={<a href="/browse">Browse</a>}
      />,
    );
    expect(hrefs(screen.getByRole("main"))).toEqual(["/browse"]);
  });

  it("publishes nothing with publish={false}, leaving the head to its host", () => {
    renderInShell(<ShellNotFound title="Gone" publish={false} />);
    expect(screen.queryByText("Gone")).toBeNull();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain(
      "Henk",
    );
  });

  // /messages drops the shell's content padding from md, so the not-found pads itself there.
  it("pads itself on a full-bleed page only", () => {
    const padding = (pathname: string) => {
      const { container, unmount } = renderInShell(
        <ShellNotFound title="Gone" />,
        pathname,
      );
      const body = container.querySelector('[data-slot="shell-not-found"]');
      const className = body?.className;
      unmount();
      return className;
    };
    expect(padding("/messages/thread_1")).toMatch(/\bmd:p-6\b/);
    expect(padding("/dashboard/no-such-page")).not.toMatch(/\bmd:p-6\b/);
  });
});

// A dead thread link (from a message notification) on a phone: /messages/<id> hides the top bar
// and the tab bar, so the title would be only ShellHeading's sr-only h1.
describe("AppNotFound on an open thread's path", () => {
  const renderOnThread = () => {
    mocks.pathname = "/messages/thread_1";
    return renderIn(
      <PageHeaderSlotProvider>
        <PageHead />
        <main>
          <ShellHeading />
          <AppNotFound />
        </main>
      </PageHeaderSlotProvider>,
    );
  };

  it("shows the title as the page's one h1 below md", () => {
    renderOnThread();
    const inMain = within(screen.getByRole("main")).getAllByRole("heading", {
      level: 1,
    });
    expect(inMain).toHaveLength(1);
    expect(inMain[0].textContent).toBe(en.notFound.title);
    expect(inMain[0].className).toContain("md:hidden");
    expect(inMain[0].className).not.toContain("sr-only");
  });

  it("keeps the page head's h1 from md", () => {
    const { container } = renderOnThread();
    const head = within(pageHead(container)).getByRole("heading", {
      level: 1,
    });
    expect(head.textContent).toBe(en.notFound.title);
  });
});
