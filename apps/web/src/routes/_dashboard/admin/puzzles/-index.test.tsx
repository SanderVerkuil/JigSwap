// @vitest-environment happy-dom
// The "-" prefix keeps the TanStack route generator from treating this file as a route.
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../../../locales/en.json";
import nl from "../../../../../locales/nl.json";
import { Route } from "./index";

// Only the definition rows matter here: data, header actions and the lifecycle button are stubbed.
const rows = vi.hoisted(() => ({ current: [] as unknown[] }));
vi.mock("convex/react", () => ({
  usePaginatedQuery: () => ({
    results: rows.current,
    status: "Exhausted",
    loadMore: () => {},
    isLoading: false,
  }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: [] }),
}));
vi.mock("@convex-dev/react-query", () => ({ convexQuery: () => ({}) }));
vi.mock("@/gateway", () => ({ gateway: { admin: {} } }));
vi.mock("@/components/dashboard-layout/page-header-slot", () => ({
  usePageHeaderActions: () => {},
}));
vi.mock("@/components/admin/puzzles/puzzle-lifecycle-action", () => ({
  PuzzleLifecycleAction: () => null,
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { component: ComponentType }) => ({
    options,
  }),
  Link: ({ children }: { children?: ReactNode }) => <a href="#">{children}</a>,
}));

const row = (title: string, overrides: Record<string, unknown> = {}) => ({
  _id: `row_${title}`,
  aggregateId: `agg_${title}`,
  title,
  pieceCount: 1000,
  status: "approved",
  createdAt: Date.UTC(2026, 9, 1),
  submitterName: null,
  image: null,
  imageMissing: false,
  ownerCount: 0,
  ...overrides,
});

const renderPage = (locale: "en" | "nl") => {
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

describe("admin puzzle definitions list", () => {
  it("marks a definition whose box art is gone, and only that one", () => {
    rows.current = [
      row("Gone", { imageMissing: true }),
      row("Fine", { image: "https://example.test/art.jpg" }),
      row("Bare"),
    ];
    renderPage("en");
    const badges = screen.getAllByText("Box art missing");
    expect(badges).toHaveLength(1);
    expect(badges[0]!.closest("a")?.textContent).toContain("Gone");
  });

  it("says it in Dutch too", () => {
    rows.current = [row("Gone", { imageMissing: true })];
    renderPage("nl");
    expect(screen.getByText("Afbeelding ontbreekt")).toBeTruthy();
  });

  it("shows no badge for rows from a backend that does not send the flag yet", () => {
    const legacy: Record<string, unknown> = row("Old");
    delete legacy.imageMissing;
    rows.current = [legacy];
    renderPage("en");
    expect(screen.queryByText("Box art missing")).toBeNull();
  });
});
