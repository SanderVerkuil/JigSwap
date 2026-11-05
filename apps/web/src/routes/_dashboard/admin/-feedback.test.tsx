// @vitest-environment happy-dom
// The "-" prefix keeps the TanStack route generator from treating this file as a route.
import { gateway } from "@/gateway";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import type { ComponentType, ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../../locales/en.json";
import { Route } from "./feedback";

const mocks = vi.hoisted(() => ({
  paginated: vi.fn(),
  loadMore: vi.fn(),
}));

vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  usePaginatedQuery: (...args: unknown[]) => mocks.paginated(...args),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: ({
    children,
    params,
  }: {
    children?: ReactNode;
    params?: { _splat?: string };
  }) => <a href={`/docs/${params?._splat}`}>{children}</a>,
}));

const vote = (i: number, slug: string, helpful: boolean) => ({
  _id: `vote_${i}`,
  _creationTime: i,
  slug,
  helpful,
  createdAt: i,
});

const answer = (
  status: string,
  results: ReturnType<typeof vote>[],
  isLoading = false,
) => {
  mocks.paginated.mockReturnValue({
    results,
    status,
    isLoading,
    loadMore: mocks.loadMore,
  });
};

const Page = Route.options.component as ComponentType;
const renderPage = () =>
  render(
    <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
      <Page />
    </IntlProvider>,
  );

const t = en.admin.docFeedback;

beforeEach(() => {
  mocks.paginated.mockReset();
  mocks.loadMore.mockReset();
});
afterEach(cleanup);

describe("the docs feedback page", () => {
  it("reads the votes a page at a time", () => {
    answer("Exhausted", []);
    renderPage();
    const [ref, args, options] = mocks.paginated.mock.calls[0]!;
    expect(getFunctionName(ref)).toBe(
      getFunctionName(gateway.adminTriage.docFeedback),
    );
    expect(args).toEqual({});
    expect(options).toEqual({ initialNumItems: 100 });
  });

  it("shows the loading and empty states", () => {
    answer("LoadingFirstPage", []);
    const { unmount } = renderPage();
    expect(screen.getByText(t.loading)).toBeTruthy();
    unmount();

    answer("Exhausted", []);
    renderPage();
    expect(screen.getByText(t.empty)).toBeTruthy();
  });

  it("says the totals are of the newest votes while more can load, and loads them", () => {
    answer("CanLoadMore", [
      vote(1, "getting-started", false),
      vote(2, "getting-started", true),
    ]);
    renderPage();
    expect(
      screen.getByText(
        "Totals of the newest 2 votes. Load more to count older ones.",
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: t.loadMore }));
    expect(mocks.loadMore).toHaveBeenCalledWith(100);
  });

  it("drops the note and the button once every vote is in", () => {
    answer("Exhausted", [vote(1, "getting-started", false)]);
    renderPage();
    expect(screen.queryByRole("button", { name: t.loadMore })).toBeNull();
    expect(screen.queryByText(/Totals of the newest/)).toBeNull();
    expect(screen.getByText("getting-started")).toBeTruthy();
  });

  it("turns a failed page into the admin error, not an endless spinner", () => {
    mocks.paginated.mockImplementation(() => {
      throw new Error("Read too much data");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    renderPage();
    expect(screen.getByRole("alert")).toBeTruthy();
    vi.restoreAllMocks();
  });
});
