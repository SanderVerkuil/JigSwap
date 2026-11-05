// @vitest-environment happy-dom
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../locales/en.json";
import nl from "../../locales/nl.json";
import { AppNotFound, MarketingNotFound, NotFound } from "./NotFound";

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

describe("AppNotFound", () => {
  it("keeps the in-app actions", () => {
    const { container } = renderIn(<AppNotFound />);
    expect(hrefs(container)).toEqual(["/dashboard", "/browse"]);
  });
});
