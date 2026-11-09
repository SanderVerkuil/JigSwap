// @vitest-environment happy-dom
// The "-" prefix keeps the TanStack route generator from treating this file as a route.
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../../locales/en.json";
import nl from "../../../../locales/nl.json";
import { Route } from "./suggestions";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: object) => ({ options }),
}));
vi.mock("@/components/dashboard-layout/page-header-slot", () => ({
  usePageHeader: () => {},
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
vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation: () => vi.fn(),
}));
// A member who has suggested nothing yet.
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: () => ({ data: [] }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));

const MySuggestionsPage = (
  Route as unknown as { options: { component: ComponentType } }
).options.component;

const renderPage = (locale: "en" | "nl" = "en") =>
  render(
    <IntlProvider
      locale={locale}
      messages={locale === "en" ? en : nl}
      timeZone="Europe/Amsterdam"
    >
      <MySuggestionsPage />
    </IntlProvider>,
  );

afterEach(cleanup);

// The empty state named "Suggest an edit" but gave no way to a puzzle that has it.
describe("My suggestions, empty", () => {
  it("offers the way to the catalogue, where Suggest an edit lives", () => {
    renderPage();
    expect(screen.getByText(en.mySuggestions.empty.title)).toBeTruthy();
    const browse = screen.getByRole("link", { name: "Browse the catalogue" });
    expect(browse.getAttribute("href")).toBe("/puzzles");
    // An outline button: the page's quiet next step, not a primary action.
    expect(browse.classList).toContain("border");
    expect(browse.classList).not.toContain("bg-primary");
  });

  it("speaks Dutch", () => {
    renderPage("nl");
    expect(
      screen
        .getByRole("link", { name: "Bekijk de catalogus" })
        .getAttribute("href"),
    ).toBe("/puzzles");
  });
});
