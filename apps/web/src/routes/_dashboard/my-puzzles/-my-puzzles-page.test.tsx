// @vitest-environment happy-dom
// The "-" prefix keeps the TanStack route generator from treating this file as a route.
import { SEARCH_COMMIT_DELAY_MS } from "@/components/library/library-search-input";
import { gateway } from "@/gateway";
import type { LoanView, OwnedCopyView } from "@jigswap/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { getFunctionName } from "convex/server";
import type { ComponentType, ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../../locales/en.json";
import { Route } from "./index";

// My Puzzles' small states: an empty library and a filter that matches nothing say different
// things, the owner select names what it filters, Recall asks first, and the one-time hint is not
// a live region. Its filters live in the URL, so they survive Back and reloads.

type SearchParams = Record<string, unknown>;

const mocks = vi.hoisted(() => {
  // A tiny stand-in for the router's location: useSearch reads it, navigate writes it.
  let search: SearchParams = {};
  const listeners = new Set<() => void>();
  return {
    queries: {} as Record<string, unknown>,
    mutation: vi.fn<(name: string, args: unknown) => Promise<unknown>>(),
    navigate: vi.fn<(options: { replace?: boolean }) => void>(),
    location: {
      get: () => search,
      set: (next: SearchParams) => {
        search = next;
        listeners.forEach((listener) => listener());
      },
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
  };
});

// Queries resolve from `mocks.queries` by function name; anything else stays unresolved.
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: (options: { queryKey: unknown[] }) => ({
    data: mocks.queries[options.queryKey[1] as string],
    isPending: !((options.queryKey[1] as string) in mocks.queries),
  }),
}));
vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation:
    (ref: Parameters<typeof getFunctionName>[0]) => (args: unknown) =>
      mocks.mutation(getFunctionName(ref), args),
}));
vi.mock("@tanstack/react-router", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    createFileRoute: () => (options: object) => ({
      options,
      fullPath: "/my-puzzles/",
      useSearch: () =>
        useSyncExternalStore(mocks.location.subscribe, mocks.location.get),
    }),
    useNavigate:
      () =>
      (options: {
        search: (prev: SearchParams) => SearchParams;
        replace?: boolean;
      }) => {
        mocks.navigate(options);
        mocks.location.set(options.search(mocks.location.get()));
      },
  };
});
vi.mock("@/compat/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/compat/clerk", () => ({
  useUser: () => ({ user: { id: "clerk_me" } }),
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
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const copy = (
  id: string,
  title: string,
  over: Partial<OwnedCopyView> = {},
): OwnedCopyView => ({
  _id: id,
  aggregateId: `agg_${id}`,
  puzzleId: `p_${id}`,
  ownerId: "me",
  condition: "good",
  availability: { forTrade: false, forLend: false, forSale: false },
  createdAt: 1,
  updatedAt: 1,
  puzzle: {
    _id: `p_${id}`,
    title,
    pieceCount: 500,
    createdAt: 1,
    updatedAt: 1,
  },
  ...over,
});

const loan = (copyDocId: string): LoanView => ({
  loanId: "loan1",
  copyId: `agg_${copyDocId}`,
  copyDocId,
  puzzleTitle: "Lent",
  pieceCount: 500,
  status: "open",
  openedAt: 1,
  lender: null,
  borrower: {
    _id: "anna",
    _creationTime: 1,
    name: "Anna",
    isActive: true,
    createdAt: 1,
    updatedAt: 1,
  },
});

const renderPage = ({
  copies,
  household = null,
  lentOut = [],
  search = {},
}: {
  copies: OwnedCopyView[];
  household?: { householdId: string; name?: string } | null;
  lentOut?: LoanView[];
  search?: SearchParams;
}) => {
  mocks.location.set(search);
  mocks.queries = {
    [getFunctionName(gateway.identity.byClerkId)]: { _id: "me" },
    [getFunctionName(gateway.library.ownedByOwner)]: copies,
    [getFunctionName(gateway.household.copies)]: [],
    [getFunctionName(gateway.household.mine)]: household,
    [getFunctionName(gateway.lending.lentOut)]: lentOut,
    [getFunctionName(gateway.solving.myCompletions)]: [],
  };
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

beforeEach(() => {
  mocks.mutation.mockReset().mockResolvedValue(null);
  mocks.navigate.mockReset();
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("My Puzzles empty states", () => {
  it("invites a member with an empty library to add their first puzzle", () => {
    renderPage({ copies: [] });
    expect(screen.getByText("No puzzles here yet")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Show all" })).toBeNull();
  });

  it("says the filter matches nothing, and Show all brings the puzzles back", () => {
    renderPage({ copies: [copy("c1", "Lam Gelegd")] });
    fireEvent.click(screen.getByRole("button", { name: "For Trade" }));

    expect(screen.getByText("No puzzles match “For Trade”")).toBeTruthy();
    expect(screen.queryByText("No puzzles here yet")).toBeNull();
    expect(screen.queryByText("Lam Gelegd")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(screen.getByText("Lam Gelegd")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "All" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });
});

describe("My Puzzles owner select", () => {
  it("names what it filters instead of a bare “All”", () => {
    renderPage({
      copies: [copy("c1", "Lam Gelegd")],
      household: { householdId: "h1" },
    });
    const trigger = screen.getByRole("combobox", { name: "Whose puzzles" });
    expect(trigger.textContent).toBe("Whose: All");
  });
});

describe("My Puzzles recall", () => {
  it("asks before recalling a lent-out copy", () => {
    renderPage({
      copies: [copy("c1", "Lam Gelegd")],
      lentOut: [loan("c1")],
    });
    fireEvent.click(screen.getByRole("button", { name: "Recall" }));
    expect(
      screen.getByRole("alertdialog", { name: "Recall this puzzle?" }),
    ).toBeTruthy();
    expect(mocks.mutation).not.toHaveBeenCalled();
  });
});

describe("My Puzzles coachmark", () => {
  it("is a plain hint, not a live region, and can be dismissed", () => {
    renderPage({ copies: [copy("c1", "Lam Gelegd")] });
    const hint = screen.getByText(
      "Quick actions like logging a solve live in the ⋯ menu on each puzzle card.",
    );
    expect(hint.closest("[role=status]")).toBeNull();
    expect(hint.closest("[aria-live]")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss hint" }));
    expect(
      screen.queryByText(
        "Quick actions like logging a solve live in the ⋯ menu on each puzzle card.",
      ),
    ).toBeNull();
  });
});

describe("My Puzzles URL state", () => {
  const library = [
    copy("c1", "Lam Gelegd", { createdAt: 3 }),
    copy("c2", "De Kattenshow", {
      createdAt: 2,
      availability: { forTrade: true, forLend: false, forSale: false },
    }),
    copy("c3", "Alpen", { createdAt: 1 }),
  ];
  const titles = () =>
    screen
      .getAllByText(/^(Lam Gelegd|De Kattenshow|Alpen)$/)
      .map((element) => element.textContent);

  it("shows the list the URL describes", () => {
    renderPage({ copies: library, search: { q: "katten" } });
    expect(
      (
        screen.getByRole("searchbox", {
          name: "Search your puzzles",
        }) as HTMLInputElement
      ).value,
    ).toBe("katten");
    expect(titles()).toEqual(["De Kattenshow"]);
  });

  it("sorts as the URL says, newest first by default", () => {
    renderPage({ copies: library });
    expect(titles()).toEqual(["Lam Gelegd", "De Kattenshow", "Alpen"]);
    cleanup();
    renderPage({ copies: library, search: { sort: "title" } });
    expect(titles()).toEqual(["Alpen", "De Kattenshow", "Lam Gelegd"]);
    cleanup();
    renderPage({
      copies: library,
      search: { sort: "title", status: "forTrade" },
    });
    expect(titles()).toEqual(["De Kattenshow"]);
  });

  it("writes a status pill into the URL without adding a history entry", () => {
    renderPage({ copies: library });
    fireEvent.click(screen.getByRole("button", { name: "For Trade" }));
    expect(mocks.location.get()).toEqual({ status: "forTrade" });
    expect(mocks.navigate).toHaveBeenLastCalledWith(
      expect.objectContaining({ replace: true }),
    );
    expect(titles()).toEqual(["De Kattenshow"]);

    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(mocks.location.get()).toEqual({});
  });

  it("writes the list view into the URL and back out for the grid", () => {
    renderPage({ copies: library });
    fireEvent.click(screen.getByRole("button", { name: "List view" }));
    expect(mocks.location.get()).toEqual({ view: "list" });
    fireEvent.click(screen.getByRole("button", { name: "Grid view" }));
    expect(mocks.location.get()).toEqual({});
  });

  it("commits a typed search to the URL once typing pauses", () => {
    vi.useFakeTimers();
    try {
      renderPage({ copies: library });
      fireEvent.change(
        screen.getByRole("searchbox", { name: "Search your puzzles" }),
        { target: { value: "alpen " } },
      );
      act(() => {
        vi.advanceTimersByTime(SEARCH_COMMIT_DELAY_MS);
      });
      expect(mocks.location.get()).toEqual({ q: "alpen" });
      expect(titles()).toEqual(["Alpen"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("names the search in the empty state; Show all keeps the view and sort", () => {
    renderPage({
      copies: library,
      search: { q: "zzz", status: "forTrade", view: "list", sort: "title" },
    });
    expect(screen.getByText("No puzzles match “zzz · For Trade”")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(mocks.location.get()).toEqual({ view: "list", sort: "title" });
    expect(
      (
        screen.getByRole("searchbox", {
          name: "Search your puzzles",
        }) as HTMLInputElement
      ).value,
    ).toBe("");
    expect(titles()).toEqual(["Alpen", "De Kattenshow", "Lam Gelegd"]);
  });
});
