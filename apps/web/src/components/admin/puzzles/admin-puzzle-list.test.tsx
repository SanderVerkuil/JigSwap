// @vitest-environment happy-dom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../../locales/en.json";
import nl from "../../../../locales/nl.json";
import { ADMIN_PUZZLES_PAGE_SIZE, AdminPuzzleList } from "./admin-puzzle-list";

const mocks = vi.hoisted(() => ({
  paginated: vi.fn<(ref: unknown, args: unknown) => unknown>(),
}));

vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  usePaginatedQuery: (ref: unknown, args: unknown) =>
    mocks.paginated(ref, args),
}));
// The lifecycle action talks to Convex; a stand-in marks where it renders.
vi.mock("./puzzle-lifecycle-action", () => ({
  PuzzleLifecycleAction: ({ title }: { title: string }) => (
    <span>lifecycle:{title}</span>
  ),
}));
// Router-free Link: the test asserts the rendered href, not routing.
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    params,
    search,
    children,
    ...rest
  }: {
    to: string;
    params?: Record<string, string>;
    search?: Record<string, string>;
    children?: ReactNode;
  }) => {
    const path = Object.entries(params ?? {}).reduce(
      (acc, [key, value]) => acc.replace(`$${key}`, value),
      to,
    );
    const query = search ? `?${new URLSearchParams(search)}` : "";
    return (
      <a href={`${path}${query}`} {...rest}>
        {children}
      </a>
    );
  },
}));

const row = (overrides: Record<string, unknown> = {}) => ({
  _id: "p1",
  aggregateId: "agg-1",
  title: "Starry Night",
  brand: "Ravensburger",
  pieceCount: 1000,
  status: "approved",
  createdAt: Date.UTC(2026, 9, 1),
  submitterName: "Ada",
  image: null,
  ownerCount: 2,
  ...overrides,
});

const page = (results: unknown[], status = "Exhausted") => ({
  results,
  status,
  loadMore: vi.fn(),
  isLoading: false,
});

const calls = {
  status: [] as (string | undefined)[],
  search: [] as (string | undefined)[],
};
beforeEach(() => {
  mocks.paginated.mockReset();
  calls.status = [];
  calls.search = [];
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

type Props = Partial<ComponentProps<typeof AdminPuzzleList>>;
const renderList = (props: Props = {}, locale: "en" | "nl" = "en") =>
  render(
    <IntlProvider
      locale={locale}
      messages={locale === "en" ? en : nl}
      timeZone="Europe/Amsterdam"
    >
      <AdminPuzzleList
        onStatusChange={(status) => calls.status.push(status)}
        onSearchChange={(term) => calls.search.push(term)}
        {...props}
      />
    </IntlProvider>,
  );

const lastArgs = () => mocks.paginated.mock.lastCall?.[1];

describe("AdminPuzzleList", () => {
  it("shows an owner count the server only counted part of as a lower bound", () => {
    mocks.paginated.mockReturnValue(
      page([row({ ownerCount: 100, ownerCountIsLowerBound: true })]),
    );
    renderList();
    expect(screen.getByText("100+ owners")).toBeTruthy();
    cleanup();

    renderList({}, "nl");
    expect(screen.getByText("100+ eigenaren")).toBeTruthy();
    cleanup();

    mocks.paginated.mockReturnValue(page([row({ ownerCount: 1 })]));
    renderList();
    expect(screen.getByText("1 owner")).toBeTruthy();
  });

  it("asks the server for the URL's status and search, and nothing more without them", () => {
    mocks.paginated.mockReturnValue(page([row()]));
    renderList();
    expect(lastArgs()).toEqual({});
    cleanup();

    renderList({ status: "pending", search: "night" });
    expect(lastArgs()).toEqual({ status: "pending", search: "night" });
  });

  it("marks the active status pill and reports a new one (All clears it)", () => {
    mocks.paginated.mockReturnValue(page([row()]));
    renderList({ status: "disabled" });
    const pressed = (name: string) =>
      screen.getByRole("button", { name }).getAttribute("aria-pressed");
    expect(pressed("Disabled")).toBe("true");
    expect(pressed("All")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "Pending" }));
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(calls.status).toEqual(["pending", undefined]);
  });

  it("shows how many submissions wait on the Pending pill", () => {
    mocks.paginated.mockReturnValue(page([row()]));
    renderList({ pendingCount: { count: 50, capped: true } });
    expect(screen.getByRole("button", { name: "Pending 50+" })).toBeTruthy();
  });

  it("writes the search term to the URL once typing pauses", () => {
    vi.useFakeTimers();
    mocks.paginated.mockReturnValue(page([row()]));
    renderList({ search: "star" });
    const input = screen.getByRole("searchbox", {
      name: "Search puzzle definitions",
    });
    expect((input as HTMLInputElement).value).toBe("star");

    fireEvent.change(input, { target: { value: "starry " } });
    expect(calls.search).toEqual([]);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(calls.search).toEqual(["starry"]);
  });

  it("links a pending row to its item in the moderation queue instead of a lifecycle action", () => {
    mocks.paginated.mockReturnValue(
      page([
        row({ _id: "p2", title: "Night Watch", status: "pending" }),
        row(),
      ]),
    );
    renderList();
    const review = screen.getByRole("link", { name: "Review “Night Watch”" });
    expect(review.textContent).toBe("Review");
    expect(review.getAttribute("href")).toBe(
      "/admin/moderation?tab=submissions&item=p2",
    );
    expect(screen.queryByText("lifecycle:Night Watch")).toBeNull();
    expect(screen.getByText("lifecycle:Starry Night")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /Starry Night/ }).getAttribute("href"),
    ).toBe("/admin/puzzles/p1");
  });

  it("gives the title room on a phone: the action takes its own line in a narrow list", () => {
    mocks.paginated.mockReturnValue(
      page([row({ title: "Een hele lange titel" })]),
    );
    renderList();
    const title = screen.getByText("Een hele lange titel");
    expect(title.className).toContain("line-clamp-2");
    expect(title.className).not.toContain("truncate");
    const link = title.closest("a");
    expect(link?.className).toContain("basis-full");
    expect(link?.className).toContain("@2xl:basis-0");
    const listRow = link?.parentElement;
    expect(listRow?.className).toContain("flex-wrap");
    expect(listRow?.className).toContain("@2xl:flex-nowrap");
    expect(listRow?.parentElement?.className).toContain("@container");
  });

  it("marks a definition whose box art file is gone (SEC-01), and only that one", () => {
    mocks.paginated.mockReturnValue(
      page([
        row({ _id: "p1", title: "Gone", imageMissing: true }),
        row({ _id: "p2", title: "Fine", imageMissing: false }),
        row({ _id: "p3", title: "Old backend" }),
      ]),
    );
    renderList();
    expect(screen.getAllByText(en.admin.puzzles.imageMissing)).toHaveLength(1);
    expect(
      screen
        .getByText(en.admin.puzzles.imageMissing)
        .closest("a")
        ?.getAttribute("href"),
    ).toBe("/admin/puzzles/p1");
  });

  it("says when the filters match nothing (nl)", () => {
    mocks.paginated.mockReturnValue(page([]));
    renderList({ status: "rejected" }, "nl");
    expect(screen.getByText("Geen puzzeldefinities gevonden")).toBeTruthy();
    cleanup();

    renderList({}, "nl");
    expect(screen.getByText(nl.admin.puzzles.empty.title)).toBeTruthy();
  });

  it("loads the next page on demand", () => {
    const result = page([row()], "CanLoadMore");
    mocks.paginated.mockReturnValue(result);
    renderList();
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(result.loadMore).toHaveBeenCalledWith(ADMIN_PUZZLES_PAGE_SIZE);
  });

  it("shows a retryable error, not the loading state, when a page fails", () => {
    // The boundary logs what it caught; keep the test output clean.
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.paginated.mockImplementation(() => {
      throw new Error("Forbidden");
    });
    renderList({ search: "night" });
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByText(en.admin.puzzles.loading)).toBeNull();

    mocks.paginated.mockReset().mockReturnValue(page([row()]));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("lifecycle:Starry Night")).toBeTruthy();
  });
});
