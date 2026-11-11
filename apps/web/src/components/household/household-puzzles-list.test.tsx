// @vitest-environment happy-dom
import { gateway } from "@/gateway";
import type { MyLibraryCopyView } from "@jigswap/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { getFunctionName } from "convex/server";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import type { HouseholdData } from "./household-page";
import { HouseholdPuzzles } from "./household-puzzles";

// The household's Puzzles tab reads a window of the library (PERF-B5q): one member's chip narrows it
// on the server, and only an availability pill reads the whole library's lean index.

const mocks = vi.hoisted(() => ({
  queries: {} as Record<string, unknown>,
  asked: {} as Record<string, unknown>,
}));

vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: (options: { queryKey: unknown[] }) => {
    mocks.asked[options.queryKey[1] as string] = options.queryKey[2];
    return {
      data: mocks.queries[options.queryKey[1] as string],
      isPlaceholderData: false,
    };
  },
}));
vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation: () => vi.fn(),
}));
vi.mock("@/compat/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/compat/link", () => ({
  Link: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const WINDOW = getFunctionName(gateway.library.myLibraryWindow);
const INDEX = getFunctionName(gateway.library.myLibraryIndex);
const COPIES = getFunctionName(gateway.library.myLibraryCopies);

const copy = (
  id: string,
  title: string,
  over: Partial<MyLibraryCopyView> = {},
): MyLibraryCopyView => ({
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

const household = {
  members: [
    { memberId: "me", name: "Me", isYou: true, role: "admin" },
    { memberId: "bob", name: "Bob", isYou: false, role: "member" },
  ],
} as unknown as HouseholdData;

const library = [
  copy("c1", "Lam Gelegd"),
  copy("c2", "De Kattenshow", {
    ownerId: "bob",
    availability: { forTrade: true, forLend: false, forSale: false },
    household: {
      owner: { memberId: "bob", name: "Bob" },
      viewerAccess: "view",
    },
  }),
];

const renderTab = (firstRows = library, hasMore = false) => {
  mocks.queries = {
    [WINDOW]: {
      rows: firstRows,
      hasMore,
      matched: library.length,
      total: library.length,
    },
    [INDEX]: library,
    [COPIES]: library,
    [getFunctionName(gateway.solving.mySolveStates)]: [],
  };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <HouseholdPuzzles household={household} />
      </IntlProvider>
    </QueryClientProvider>,
  );
};

afterEach(cleanup);

describe("HouseholdPuzzles", () => {
  it("everyone's puzzles read a window, not the whole library", () => {
    renderTab();
    expect(mocks.asked[INDEX]).toBe("skip");
    expect(mocks.asked[WINDOW]).toEqual({ limit: 48 });
    expect(screen.getByText("Lam Gelegd")).toBeTruthy();
    expect(screen.getByText("De Kattenshow")).toBeTruthy();
    expect(screen.getByText("2 of 2 puzzles")).toBeTruthy();
  });

  it("a member's chip asks the server for that member", () => {
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: /Bob$/ }));
    expect(mocks.asked[INDEX]).toBe("skip");
    expect(mocks.asked[WINDOW]).toEqual({ memberId: "bob", limit: 48 });
  });

  it("an availability pill filters the index and joins only what it leaves", () => {
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: "For Trade" }));
    expect(mocks.asked[INDEX]).toEqual({});
    expect(mocks.asked[WINDOW]).toBe("skip");
    expect(mocks.asked[COPIES]).toEqual({ copyIds: ["c2"] });
    expect(screen.getByText("De Kattenshow")).toBeTruthy();
    expect(screen.queryByText("Lam Gelegd")).toBeNull();
    expect(screen.getByText("1 of 2 puzzles")).toBeTruthy();
  });

  // The owner filter is a single choice like the availability one below it: both sit in the tab
  // track, the chosen option a white window, never the canal fill of an action.
  it("marks the chosen owner as the tab track's window, not a primary button", () => {
    renderTab();
    const group = screen.getByRole("group", { name: "Filter by owner" });
    const everyone = within(group).getByRole("button", { name: "Everyone" });
    const bob = within(group).getByRole("button", { name: /Bob$/ });
    expect([...everyone.parentElement!.classList]).toEqual(
      expect.arrayContaining(["bg-muted", "rounded-lg", "p-[3px]"]),
    );
    for (const chip of within(group).getAllByRole("button")) {
      expect(chip.classList).not.toContain("rounded-full");
      expect(chip.classList).not.toContain("bg-jigsaw-primary");
    }
    expect(everyone.getAttribute("aria-pressed")).toBe("true");
    expect(everyone.classList).toContain("bg-background");
    expect(bob.classList).not.toContain("bg-background");

    fireEvent.click(bob);
    expect(bob.getAttribute("aria-pressed")).toBe("true");
    expect(bob.classList).toContain("bg-background");
    expect(everyone.classList).not.toContain("bg-background");
  });

  it("offers Show more while the server says there is more", () => {
    renderTab(library.slice(0, 1), true);
    expect(screen.queryByText("De Kattenshow")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(mocks.asked[WINDOW]).toEqual({ limit: 96 });
  });
});
