// @vitest-environment happy-dom
// The "-" prefix keeps the TanStack route generator from treating this file as a route.
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentType, ReactElement, ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../../locales/en.json";
import nl from "../../../../locales/nl.json";
import { Route } from "./past";

// Marking past solves is its own page of the completion log: a member with a long history can come
// back to it, it stays on the page after a batch, and it never enters the quick start flow.

const mocks = vi.hoisted(() => ({
  header: undefined as
    | {
        title?: unknown;
        crumbs?: { label: string; href?: string }[];
        actions?: ReactElement;
      }
    | undefined,
  form: undefined as
    | { emptyText?: string; emptyAction?: ReactNode; onLogged?: unknown }
    | undefined,
}));

vi.mock("@/compat/link", () => ({
  Link: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: object) => ({ options }),
}));
vi.mock("@/components/dashboard-layout/page-header-slot", () => ({
  usePageHeader: (factory: () => NonNullable<typeof mocks.header>) => {
    mocks.header = factory();
  },
}));
vi.mock("@/components/solving/past-solves-form", () => ({
  PastSolvesForm: (props: NonNullable<typeof mocks.form>) => {
    mocks.form = props;
    return <div>{props.emptyAction}</div>;
  },
}));

const renderPage = (locale: "en" | "nl" = "en") => {
  const Page = (Route as unknown as { options: { component: ComponentType } })
    .options.component;
  render(
    <IntlProvider
      locale={locale}
      messages={locale === "en" ? en : nl}
      timeZone="Europe/Amsterdam"
    >
      <Page />
    </IntlProvider>,
  );
};

afterEach(cleanup);

describe("Mark past solves page", () => {
  it("sits under the completion log, with a way back to it", () => {
    renderPage();
    expect(mocks.header?.title).toBe("Mark past solves");
    expect(mocks.header?.crumbs).toEqual([
      { label: en.shell.groups.library.label, href: "/library" },
      { label: en.shell.pages.completions.title, href: "/completions" },
    ]);
    render(mocks.header?.actions as ReactElement);
    expect(
      screen
        .getByRole("link", { name: "Back to Completions" })
        .getAttribute("href"),
    ).toBe("/completions");
  });

  it("says the limit up front", () => {
    renderPage();
    expect(screen.getByText(/up to 25 at a time/)).toBeTruthy();
  });

  it("stays on the page after a batch: nothing navigates when it is logged", () => {
    renderPage();
    expect(mocks.form?.onLogged).toBeUndefined();
  });

  it("says what is left when nothing is, and offers adding a puzzle", () => {
    renderPage();
    expect(mocks.form?.emptyText).toBe(
      "No puzzles left to mark. Puzzles you've logged a solve for don't show here.",
    );
    expect(
      screen.getByRole("link", { name: "Add a puzzle" }).getAttribute("href"),
    ).toBe("/my-puzzles/add");
  });

  it("speaks Dutch", () => {
    renderPage("nl");
    expect(mocks.header?.title).toBe("Eerdere voltooiingen vastleggen");
    expect(screen.getByText(/tot 25 tegelijk/)).toBeTruthy();
  });
});
