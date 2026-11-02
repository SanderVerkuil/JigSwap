// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps, ComponentType } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../locales/en.json";
import nl from "../../locales/nl.json";
import { Route } from "./members.$handle";

// The head reads the strings from the loaded catalog of the context's locale.
vi.mock("@/lib/i18n-catalog", () => ({
  messagesFor: (locale: string) => (locale === "nl" ? nl : en),
}));

const viewer = vi.hoisted(() => ({ userId: null as string | null }));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: object) => ({
    options,
    useRouteContext: () => ({ sidebar: {} }),
  }),
  useRouteContext: () => viewer,
  notFound: vi.fn(),
  redirect: vi.fn(),
  useNavigate: () => vi.fn(),
  Link: ({ to, children, ...rest }: ComponentProps<"a"> & { to: string }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/compat/link", () => ({
  Link: ({
    href,
    children,
    ...rest
  }: ComponentProps<"a"> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/marketing/header", () => ({
  MarketingHeader: () => <header />,
}));
vi.mock("@/components/marketing/footer", () => ({
  MarketingFooter: () => <footer />,
}));
vi.mock("@/components/dashboard-layout/shell", () => ({
  DashboardShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="shell">{children}</div>
  ),
}));

type MetaTag = {
  title?: string;
  name?: string;
  property?: string;
  content?: string;
};
const { options } = Route as unknown as {
  options: {
    head: (args: {
      loaderData?: unknown;
      match: { context: unknown; pathname: string; status: string };
    }) => { meta: MetaTag[] };
    notFoundComponent: ComponentType;
  };
};

const headOf = (
  locale: "en" | "nl",
  visibility?: "public" | "private",
  status = "success",
) =>
  options.head({
    loaderData: visibility && {
      profile: {
        hero: {
          displayName: "Mara",
          visibility,
          bio: "Likes windmills",
          avatar: "https://cdn.test/a.png",
          location: "Obdam",
        },
      },
    },
    match: {
      context: { intl: { locale, timeZone: "Europe/Amsterdam" } },
      pathname: "/members/mara",
      status,
    },
  }).meta;

const content = (meta: MetaTag[], key: string) =>
  meta.find((tag) => tag.name === key || tag.property === key)?.content;

afterEach(() => {
  cleanup();
  viewer.userId = null;
});

describe("member page share tags", () => {
  it.each([
    [
      "en",
      "en_US",
      "Follow Mara on JigSwap, the place to lend and swap jigsaw puzzles.",
    ],
    [
      "nl",
      "nl_NL",
      "Volg Mara op JigSwap, dé plek om legpuzzels uit te lenen en te ruilen.",
    ],
  ] as const)(
    "describes the invite for link previews (%s)",
    (locale, ogLocale, description) => {
      const meta = headOf(locale, "public");
      expect(meta[0].title).toBe("Mara — JigSwap");
      expect(content(meta, "description")).toBe(description);
      expect(content(meta, "og:description")).toBe(description);
      expect(content(meta, "og:title")).toBe("Mara — JigSwap");
      expect(content(meta, "og:site_name")).toBe("JigSwap");
      expect(content(meta, "og:locale")).toBe(ogLocale);
      expect(content(meta, "robots")).toBeUndefined();
    },
  );

  it("keeps a private profile out of search, and adds nothing beyond its name", () => {
    const meta = headOf("en", "private");
    expect(content(meta, "robots")).toBe("noindex");
    const tags = JSON.stringify(meta);
    for (const field of ["windmills", "cdn.test", "Obdam"]) {
      expect(tags).not.toContain(field);
    }
  });

  it("titles an unknown member as a page not found, in the visitor's language", () => {
    expect(headOf("en", undefined, "notFound")[0].title).toBe(
      "Page not found — JigSwap",
    );
    expect(headOf("nl", undefined, "notFound")[0].title).toBe(
      "Pagina niet gevonden — JigSwap",
    );
  });

  it("keeps the generic title while the member is still loading", () => {
    expect(headOf("en", undefined, "pending")[0].title).toBe(
      "Members — JigSwap",
    );
  });
});

describe("member not found", () => {
  const renderNotFound = (locale: "en" | "nl" = "en") => {
    const NotFound = options.notFoundComponent;
    render(
      <IntlProvider
        locale={locale}
        messages={locale === "nl" ? nl : en}
        timeZone="Europe/Amsterdam"
      >
        <NotFound />
      </IntlProvider>,
    );
  };

  it("gives a visitor the site's 404, naming what is missing", () => {
    renderNotFound();
    expect(screen.getByText("404")).toBeTruthy();
    expect(
      screen.getByRole("heading", { level: 1, name: "Member not found" }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "This link may be outdated, or the member may have changed their username.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to home" })).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Browse the catalogue" })
        .getAttribute("href"),
    ).toBe("/catalog");
    expect(screen.getByRole("main")).toBeTruthy();
  });

  it("says in natural Dutch that the member may have picked another username", () => {
    renderNotFound("nl");
    expect(
      screen.getByText(
        "Deze link is mogelijk verouderd, of dit lid heeft een andere gebruikersnaam gekozen.",
      ),
    ).toBeTruthy();
  });

  it("keeps a member in the app, with a way to find people", () => {
    viewer.userId = "user_1";
    renderNotFound();
    expect(screen.getByTestId("shell")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Find people" }).getAttribute("href"),
    ).toBe("/people");
  });
});
