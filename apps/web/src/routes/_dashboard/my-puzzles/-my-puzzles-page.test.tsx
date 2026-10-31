// @vitest-environment happy-dom
// The "-" prefix keeps the TanStack route generator from treating this file as a route.
import { gateway } from "@/gateway";
import type { LoanView, OwnedCopyView } from "@jigswap/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import type { ComponentType, ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../../locales/en.json";
import { Route } from "./index";

// My Puzzles' small states: an empty library and a filter that matches nothing say different
// things, the owner select names what it filters, Recall asks first, and the one-time hint is not
// a live region.

const mocks = vi.hoisted(() => ({
  queries: {} as Record<string, unknown>,
  mutation: vi.fn<(name: string, args: unknown) => Promise<unknown>>(),
}));

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
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: object) => ({ options }),
}));
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
}: {
  copies: OwnedCopyView[];
  household?: { householdId: string; name?: string } | null;
  lentOut?: LoanView[];
}) => {
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
