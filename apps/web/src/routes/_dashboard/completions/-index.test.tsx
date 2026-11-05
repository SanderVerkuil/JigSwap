// @vitest-environment happy-dom
// The "-" prefix keeps the TanStack route generator from treating this file as a route.
import { gateway } from "@/gateway";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { getFunctionName } from "convex/server";
import type { ComponentType, ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../../locales/en.json";
import { Route } from "./index";

// The completion log reads a lean row per solve for its stats, order and year headings, and joins
// only the rows on screen (PERF-B13). It no longer reads the member's library at all.

const mocks = vi.hoisted(() => ({
  queries: {} as Record<string, unknown>,
  // The arguments each query was last asked with.
  asked: {} as Record<string, unknown>,
}));

vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: (options: { queryKey: unknown[] }) => {
    const name = options.queryKey[1] as string;
    mocks.asked[name] = options.queryKey[2];
    return {
      data: mocks.queries[name],
      isPending: !(name in mocks.queries),
      isPlaceholderData: false,
    };
  },
}));
vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation: () => vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: object) => ({ options }),
}));
vi.mock("@/compat/clerk", () => ({
  useUser: () => ({ user: { id: "clerk_me" } }),
}));
vi.mock("@/compat/link", () => ({
  Link: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/components/dashboard-layout/page-header-slot", () => ({
  usePageHeader: () => {},
}));
vi.mock("@/components/whats-new/tour-launcher", () => ({
  useTourLauncher: () => ({ startTour: () => {} }),
}));
// A row is its id here; its own tests cover the rest.
vi.mock("@/components/solving/completion-row", () => ({
  CompletionRow: ({
    completion,
    info,
  }: {
    completion: { _id: string };
    info?: { title: string };
  }) => (
    <div data-testid="row">
      {completion._id}
      {info ? ` ${info.title}` : ""}
    </div>
  ),
}));

vi.mock("@/components/solving/completions-empty-state", () => ({
  CompletionsEmptyState: () => <p>nothing logged yet</p>,
}));

const INDEX = getFunctionName(gateway.solving.myCompletionIndex);
const BY_IDS = getFunctionName(gateway.solving.myCompletionsByIds);

const finished = (id: string, year: number, pieceCount = 500) => ({
  _id: id,
  isCompleted: true,
  startDate: Date.UTC(year, 2, 1),
  endDate: Date.UTC(year, 2, 2),
  pieceCount,
});
const open = (id: string, startDate: number) => ({
  _id: id,
  isCompleted: false,
  startDate,
});

const renderLog = (index: unknown[], rows = index) => {
  mocks.queries = {
    [getFunctionName(gateway.identity.byClerkId)]: { _id: "me" },
    [INDEX]: index,
    [BY_IDS]: rows,
  };
  mocks.asked = {};
  const Page = (Route as unknown as { options: { component: ComponentType } })
    .options.component;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <Page />
      </IntlProvider>
    </QueryClientProvider>,
  );
};

const shownRows = () =>
  screen.queryAllByTestId("row").map((row) => row.textContent);

afterEach(cleanup);

describe("completion log", () => {
  it("counts its stats over every solve, not only those joined", () => {
    const year = new Date().getFullYear();
    const log = [
      finished("a", year, 1000),
      finished("b", year - 1, 500),
      finished("c", year - 2, 250),
      open("d", 5),
    ];
    renderLog(log, []);
    const stats = screen.getByText(en.solving.completions.stats.pieces)
      .parentElement!.parentElement!;
    expect(within(stats).getByText("1,750")).toBeTruthy();
    expect(within(stats).getByText("3")).toBeTruthy();
    expect(within(stats).getByText("1")).toBeTruthy();
  });

  it("joins the solves in progress and the first page of history, nothing further", () => {
    const history = Array.from({ length: 40 }, (_, i) =>
      finished(`h${i}`, 2020 - i),
    );
    renderLog([...history, open("p-old", 1), open("p-new", 9)]);
    const asked = mocks.asked[BY_IDS] as { completionIds: string[] };
    expect(asked.completionIds).toHaveLength(32);
    // In progress first, newest started on top; then the newest years.
    expect(asked.completionIds.slice(0, 3)).toEqual(["p-new", "p-old", "h0"]);
    expect(asked.completionIds).not.toContain("h30");
    expect(shownRows().slice(0, 3)).toEqual(["p-new", "p-old", "h0"]);
  });

  it("Show more joins the next page", () => {
    const history = Array.from({ length: 40 }, (_, i) =>
      finished(`h${i}`, 2020 - i),
    );
    renderLog(history);
    fireEvent.click(screen.getByRole("button", { name: "Show 10 more" }));
    const asked = mocks.asked[BY_IDS] as { completionIds: string[] };
    expect(asked.completionIds).toHaveLength(40);
    expect(asked.completionIds).toContain("h39");
  });

  it("passes on the library info the join found", () => {
    renderLog(
      [finished("a", 2020)],
      [
        {
          ...finished("a", 2020),
          libraryInfo: { title: "Harbour Lights", pieceCount: 1000 },
        },
      ],
    );
    expect(shownRows()).toEqual(["a Harbour Lights"]);
  });

  it("shows the empty state, and joins nothing, with no solves at all", () => {
    renderLog([]);
    expect(screen.queryAllByTestId("row")).toEqual([]);
    expect(mocks.asked[BY_IDS]).toBe("skip");
    expect(screen.getByText("nothing logged yet")).toBeTruthy();
  });

  it("never reads the member's library", () => {
    renderLog([finished("a", 2020)]);
    expect(Object.keys(mocks.asked)).not.toContain(
      getFunctionName(gateway.library.ownedByOwner),
    );
  });
});
