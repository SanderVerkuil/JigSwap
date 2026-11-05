// @vitest-environment happy-dom
import { gateway, type Id } from "@/gateway";
import { convexQuery, ConvexQueryClient } from "@convex-dev/react-query";
import type { LoanView } from "@jigswap/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ConvexReactClient } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import type { ComponentType, ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../../locales/en.json";
import nl from "../../../../locales/nl.json";
import { Route } from "./index";

// A tiny stand-in for the router's location: the filters live in the URL.
const location = vi.hoisted(() => {
  let search: Record<string, unknown> = {};
  const listeners = new Set<() => void>();
  return {
    get: () => search,
    set: (next: Record<string, unknown>) => {
      search = next;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
});

vi.mock("@/compat/clerk", () => ({
  useUser: () => ({ user: { id: "clerk_me" } }),
}));
vi.mock("@/compat/link", () => ({
  Link: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@tanstack/react-router", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    createFileRoute: () => (options: { component: ComponentType }) => ({
      options,
      useSearch: () =>
        useSyncExternalStore(location.subscribe, location.get, location.get),
    }),
    useNavigate:
      () =>
      ({
        search,
      }: {
        search: (prev: Record<string, unknown>) => Record<string, unknown>;
      }) => {
        location.set(search(location.get()));
      },
  };
});
vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation: () => vi.fn(),
}));
// The card and its ⋯ actions have their own tests; here a card is just its title.
vi.mock("@/components/library/copy-card-actions", () => ({
  useSolveStateByCopyId: () => new Map(),
  useCopyCardActions: () => ({ cardActions: () => ({}), dialogs: null }),
}));
vi.mock("@/components/ui/puzzle-card", () => ({
  PuzzleViewProvider: ({ children }: { children?: ReactNode }) => (
    <ul>{children}</ul>
  ),
  PuzzleCard: ({ puzzle }: { puzzle: { snapshot: { title: string } } }) => (
    <li>{puzzle.snapshot.title}</li>
  ),
}));

type OwnedCopies = FunctionReturnType<typeof gateway.library.ownedByOwner>;

const copy = (id: string, title: string, forLend: boolean) => ({
  _id: id,
  snapshot: { title },
  availability: { forTrade: false, forSale: false, forLend },
  createdAt: 0,
});

const lentOutLoan = {
  loanId: "loan-1",
  copyId: "copy-agg-b",
  copyDocId: "copy-b",
  puzzleTitle: "Tulip Fields",
  pieceCount: 500,
  status: "open",
  openedAt: 0,
  lender: null,
  borrower: null,
} satisfies LoanView;

const renderPage = (locale: "en" | "nl" = "en") => {
  const convexQueryClient = new ConvexQueryClient(
    new ConvexReactClient("https://example.convex.cloud"),
  );
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        queryKeyHashFn: convexQueryClient.hashFn(),
        staleTime: Infinity,
        retry: false,
        queryFn: () => new Promise<never>(() => {}),
      },
    },
  });
  const seed = (key: readonly unknown[], data: unknown) =>
    queryClient.setQueryData(key, data);
  seed(
    convexQuery(gateway.identity.byClerkId, { clerkId: "clerk_me" }).queryKey,
    { _id: "u_me" },
  );
  seed(
    convexQuery(gateway.library.ownedByOwner, {
      ownerId: "u_me" as Id<"users">,
      includeUnavailable: true,
    }).queryKey,
    [
      copy("copy-a", "Harbour Lights", true),
      copy("copy-b", "Tulip Fields", false),
      copy("copy-c", "Night Market", false),
    ] as unknown as OwnedCopies,
  );
  seed(convexQuery(gateway.household.copies, {}).queryKey, []);
  seed(convexQuery(gateway.household.mine, {}).queryKey, null);
  seed(convexQuery(gateway.lending.lentOut, {}).queryKey, [lentOutLoan]);

  const Page = (Route as unknown as { options: { component: ComponentType } })
    .options.component;
  render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider
        locale={locale}
        messages={locale === "en" ? en : nl}
        timeZone="Europe/Amsterdam"
      >
        <Page />
      </IntlProvider>
    </QueryClientProvider>,
  );
};

const titles = () =>
  screen.getAllByRole("listitem").map((item) => item.textContent);

afterEach(() => {
  cleanup();
  location.set({});
});

describe("My Puzzles › Lent out filter", () => {
  it("narrows the library to the copies that are out with a borrower", () => {
    renderPage();
    expect(titles()).toEqual([
      "Harbour Lights",
      "Tulip Fields",
      "Night Market",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Lent Out" }));
    expect(titles()).toEqual(["Tulip Fields"]);
    expect(screen.getByText("1 of 3 puzzles")).toBeTruthy();

    // Offered for lending is not the same as lent out.
    fireEvent.click(screen.getByRole("button", { name: "For Loan" }));
    expect(titles()).toEqual(["Harbour Lights"]);
  });

  it("keeps the filter in the URL, so Back from a copy or a reload shows the same list", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Lent Out" }));
    expect(location.get()).toEqual({ status: "lentOut" });

    cleanup();
    renderPage();
    expect(titles()).toEqual(["Tulip Fields"]);
  });

  it("is labelled in Dutch", () => {
    renderPage("nl");
    fireEvent.click(screen.getByRole("button", { name: "Uitgeleend" }));
    expect(titles()).toEqual(["Tulip Fields"]);
  });
});
