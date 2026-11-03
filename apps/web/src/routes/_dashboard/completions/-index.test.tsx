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
  // The rows each page of the join asks for, one array per read.
  pages: [] as string[][],
}));

vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: (options: { queryKey: unknown[] }) => {
    const name = options.queryKey[1] as string;
    mocks.asked[name] = options.queryKey[2];
    return {
      data: mocks.queries[name],
      isPending: !(name in mocks.queries),
    };
  },
  // The join: each page answers with the rows it asked for that the test's join holds.
  useQueries: ({ queries }: { queries: { queryKey: unknown[] }[] }) => {
    mocks.pages = queries.map(
      ({ queryKey }) =>
        (queryKey[2] as { completionIds: string[] }).completionIds,
    );
    return queries.map(({ queryKey }) => {
      const rows = mocks.queries[queryKey[1] as string] as
        { _id: string }[] | undefined;
      const { completionIds } = queryKey[2] as { completionIds: string[] };
      return {
        data: rows?.filter((row) => completionIds.includes(row._id)),
      };
    });
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

vi.mock(
  "@/components/solving/completions-empty-state",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/components/solving/completions-empty-state")
    >()),
    CompletionsEmptyState: () => <p>nothing logged yet</p>,
  }),
);

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
const undated = (id: string) => ({
  ...finished(id, 2026),
  datePrecision: "unknown",
});

const Page = (Route as unknown as { options: { component: ComponentType } })
  .options.component;
const queryClient = new QueryClient();
const log = () => (
  <QueryClientProvider client={queryClient}>
    <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
      <Page />
    </IntlProvider>
  </QueryClientProvider>
);

// `rows` null: the join hasn't answered yet.
const renderLog = (index: unknown[], rows: unknown[] | null = index) => {
  mocks.queries = {
    [getFunctionName(gateway.identity.byClerkId)]: { _id: "me" },
    [INDEX]: index,
    [BY_IDS]: rows ?? undefined,
  };
  mocks.asked = {};
  mocks.pages = [];
  return render(log());
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
    const asked = mocks.pages.flat();
    expect(asked).toHaveLength(32);
    // In progress first, newest started on top; then the newest years.
    expect(asked.slice(0, 3)).toEqual(["p-new", "p-old", "h0"]);
    expect(asked).not.toContain("h30");
    expect(shownRows().slice(0, 3)).toEqual(["p-new", "p-old", "h0"]);
  });

  it("Show more joins the next page", () => {
    const history = Array.from({ length: 40 }, (_, i) =>
      finished(`h${i}`, 2020 - i),
    );
    renderLog(history);
    fireEvent.click(screen.getByRole("button", { name: "Show 10 more" }));
    const asked = mocks.pages.flat();
    expect(asked).toHaveLength(40);
    expect(asked).toContain("h39");
  });

  // A read's cost has to fit Convex's limit even with every image URL counted, so the depth of the log
  // can't depend on what the deepest member's rows hold: it is one read per page.
  it("reaches a member's last solve, one read of at most a page at a time", () => {
    const history = Array.from({ length: 300 }, (_, i) =>
      finished(`h${i}`, 2020 - i),
    );
    renderLog([...history, undated("forgotten")]);
    for (let shown = 30; shown <= 300; shown += 30) {
      fireEvent.click(screen.getByRole("button", { name: /^Show \d+ more$/ }));
    }
    expect(screen.queryByRole("button", { name: /^Show / })).toBeNull();
    expect(shownRows()).toHaveLength(301);
    expect(shownRows().at(-1)).toBe("forgotten");
    expect(Math.max(...mocks.pages.map((page) => page.length))).toBe(30);
    expect(new Set(mocks.pages.flat()).size).toBe(301);
  });

  it("leaves the pages it has asked for alone when another page opens", () => {
    const history = Array.from({ length: 40 }, (_, i) =>
      finished(`h${i}`, 2020 - i),
    );
    renderLog(history);
    const first = mocks.pages[0];
    fireEvent.click(screen.getByRole("button", { name: "Show 10 more" }));
    expect(mocks.pages[0]).toEqual(first);
    expect(mocks.pages).toHaveLength(2);
  });

  // Every later row moves down one, so asking by position would ask for every page again, and the log
  // would blink.
  it("asks for a solve logged at the top on its own, leaving the rest as they are", () => {
    const history = Array.from({ length: 30 }, (_, i) =>
      finished(`h${i}`, 2020 - i),
    );
    const { rerender } = renderLog(history);
    const [first] = mocks.pages;
    const logged = finished("new", 2021);
    mocks.queries[INDEX] = [logged, ...history];
    mocks.queries[BY_IDS] = [logged, ...history];
    rerender(log());
    expect(mocks.pages).toEqual([first, ["new"]]);
    expect(shownRows()[0]).toBe("new");
  });

  it("doesn't leave a placeholder for a row the finished join didn't return", () => {
    renderLog(
      [finished("a", 2024), finished("b", 2024)],
      [finished("a", 2024)],
    );
    expect(shownRows()).toHaveLength(1);
    expect(document.querySelector('[data-slot="skeleton"]')).toBeNull();
  });

  it("holds a placeholder for each row while the join is on its way", () => {
    renderLog([finished("a", 2024), finished("b", 2024)], null);
    expect(shownRows()).toHaveLength(0);
    expect(document.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(2);
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

  it("opens an empty log on its empty state, without three zeros above it", () => {
    renderLog([]);
    expect(screen.queryByText(en.solving.completions.stats.pieces)).toBeNull();
    expect(screen.getByText("nothing logged yet")).toBeTruthy();
  });

  it("shows the empty state, and joins nothing, with no solves at all", () => {
    renderLog([]);
    expect(screen.queryAllByTestId("row")).toEqual([]);
    expect(mocks.pages).toEqual([]);
    expect(screen.getByText("nothing logged yet")).toBeTruthy();
  });

  it("keeps marking past solves within reach once there is a log", () => {
    renderLog([finished("a", 2024)]);
    expect(
      screen
        .getByRole("link", { name: "Mark past solves" })
        .getAttribute("href"),
    ).toBe("/completions/past");
  });

  // A member with hundreds of puzzles passes a full page of rows after two batches. Under the log
  // the link would be three screens down and move further with every Show more.
  it("puts marking past solves above the log, however long the log is", () => {
    const history = Array.from({ length: 40 }, (_, i) =>
      finished(`h${i}`, 2020 - i),
    );
    renderLog([...history, open("p", 9)]);
    const link = screen.getByRole("link", { name: "Mark past solves" });
    const [firstRow] = screen.getAllByTestId("row");
    expect(
      link.compareDocumentPosition(firstRow) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      link.compareDocumentPosition(
        screen.getByText(en.solving.completions.inProgressSection),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("never reads the member's library", () => {
    renderLog([finished("a", 2020)]);
    expect(Object.keys(mocks.asked)).not.toContain(
      getFunctionName(gateway.library.ownedByOwner),
    );
  });
});
