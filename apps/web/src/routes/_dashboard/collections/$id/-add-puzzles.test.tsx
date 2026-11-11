// @vitest-environment happy-dom
// The "-" prefix keeps the TanStack route generator from treating this file as a route.
import {
  PageHeaderSlotProvider,
  usePageHeaderContent,
} from "@/components/dashboard-layout/page-header-slot";
import { isSurfaceBusy } from "@/components/whats-new/surface-busy";
import { gateway, type Id } from "@/gateway";
import { convexQuery, ConvexQueryClient } from "@convex-dev/react-query";
import type { CollectionDetailView, OwnedCopyView } from "@jigswap/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { ConvexReactClient } from "convex/react";
import { getFunctionName } from "convex/server";
import type { ComponentType, ReactNode } from "react";
import { toast } from "sonner";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../../../locales/en.json";
import { Route } from "./add-puzzles";

// The collection's "Add Puzzles" picker offers every copy in the member's library (not only the
// ones on offer), says why the list is empty, and reports copies it couldn't add.

const mocks = vi.hoisted(() => ({
  mutation: vi.fn<(name: string, args: unknown) => Promise<unknown>>(),
  push: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: object) => ({
    options,
    useParams: () => ({ id: "col_doc" }),
  }),
  useLocation: (opts?: {
    select?: (location: { pathname: string }) => unknown;
  }) => {
    const location = { pathname: "/collections/col_doc/add-puzzles" };
    return opts?.select ? opts.select(location) : location;
  },
}));
vi.mock("@/compat/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));
vi.mock("@/compat/clerk", () => ({
  useUser: () => ({ user: { id: "clerk_me" } }),
}));
vi.mock("@/compat/link", () => ({
  Link: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/hooks/use-box-art-check", () => ({
  useBoxArtInCheck: () => new Set<string>(),
}));
vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation:
    (ref: Parameters<typeof getFunctionName>[0]) => (args: unknown) =>
      mocks.mutation(getFunctionName(ref), args),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const ADD = getFunctionName(gateway.collections.addOwnedPuzzle);
const ME = "me" as Id<"users">;

const copy = (
  n: number,
  extra: Partial<OwnedCopyView> = {},
): OwnedCopyView => ({
  _id: `copy_doc_${n}`,
  aggregateId: `copy_agg_${n}`,
  puzzleId: `puzzle_${n}`,
  ownerId: ME,
  condition: "good",
  // Not on offer: a copy kept for yourself belongs in a collection too.
  availability: { forTrade: false, forLend: false, forSale: false },
  visibility: "private",
  createdAt: n,
  updatedAt: n,
  coverUrl: null,
  puzzle: {
    _id: `puzzle_${n}`,
    title: `Puzzle ${n}`,
    brand: "Ravensburger",
    pieceCount: 1000,
    createdAt: 0,
    updatedAt: 0,
  },
  ...extra,
});

const collection = (puzzles: OwnedCopyView[]): CollectionDetailView => ({
  _id: "col_doc",
  _creationTime: 0,
  aggregateId: "col_agg",
  userId: ME,
  name: "Cats",
  visibility: "private",
  isDefault: false,
  createdAt: 0,
  updatedAt: 0,
  puzzles,
  hasMorePuzzles: false,
});

function PublishedActions() {
  const { title, crumbs, actions } = usePageHeaderContent();
  return (
    <>
      <output data-testid="head">{JSON.stringify({ title, crumbs })}</output>
      <div data-testid="head-actions">{actions}</div>
    </>
  );
}

// `shown`: the collection as read, `null` for a missing or private one, or "unreadable" when the
// read fails (a malformed id).
const renderPicker = ({
  library,
  inCollection = [],
  shown = collection(inCollection),
}: {
  library: OwnedCopyView[];
  inCollection?: OwnedCopyView[];
  shown?: CollectionDetailView | null | "unreadable";
}) => {
  const convexQueryClient = new ConvexQueryClient(
    new ConvexReactClient("https://example.convex.cloud"),
  );
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        queryKeyHashFn: convexQueryClient.hashFn(),
        staleTime: Infinity,
        retry: false,
        queryFn:
          shown === "unreadable"
            ? () => Promise.reject(new Error("ArgumentValidationError"))
            : () => new Promise<never>(() => {}),
      },
    },
  });
  queryClient.setQueryData(
    convexQuery(gateway.identity.byClerkId, { clerkId: "clerk_me" }).queryKey,
    { _id: ME },
  );
  if (shown !== "unreadable") {
    queryClient.setQueryData(
      convexQuery(gateway.collections.byId, {
        collectionId: "col_doc" as Id<"collections">,
      }).queryKey,
      shown,
    );
  }
  // Seeded ONLY for the whole-library read: a picker that asked for the offered copies alone
  // would never resolve and stay on its loading screen.
  queryClient.setQueryData(
    convexQuery(gateway.library.ownedByOwner, {
      ownerId: ME,
      includeUnavailable: true,
    }).queryKey,
    library,
  );
  const Page = (Route as unknown as { options: { component: ComponentType } })
    .options.component;
  render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <PageHeaderSlotProvider>
          <Page />
          <PublishedActions />
        </PageHeaderSlotProvider>
      </IntlProvider>
    </QueryClientProvider>,
  );
};

const selectCard = (title: string) => {
  const card = screen.getByText(title).closest("[data-slot='card'], article");
  const checkbox = (card ?? document).querySelector("input[type=checkbox]");
  if (!checkbox) throw new Error(`no checkbox for ${title}`);
  fireEvent.click(checkbox);
};

beforeEach(() => {
  mocks.mutation.mockReset().mockResolvedValue(null);
  mocks.push.mockReset();
  vi.mocked(toast.error).mockReset();
});
afterEach(cleanup);

describe("collection Add Puzzles picker for a collection that can't be shown", () => {
  it.each([
    ["is missing or private", null],
    ["has an unreadable id", "unreadable"],
  ] as const)(
    "says so when it %s, with the way back and nothing to confirm",
    async (_, shown) => {
      renderPicker({ library: [copy(1)], shown });
      const back = await screen.findByRole("link", {
        name: "Back to Collections",
      });
      expect(back.getAttribute("href")).toBe("/collections");
      expect(screen.getByText(en.collections.notFoundSub)).toBeTruthy();
      expect(screen.queryByText("Puzzle 1")).toBeNull();
      await waitFor(() =>
        expect(
          JSON.parse(screen.getByTestId("head").textContent ?? ""),
        ).toEqual({ title: "Collection not found", crumbs: [] }),
      );
      // No Cancel or Add selected left in the head.
      expect(screen.getByTestId("head-actions").childElementCount).toBe(0);
    },
  );
});

describe("collection Add Puzzles picker", () => {
  it("shows each copy's whole box, as My Puzzles does", () => {
    renderPicker({
      library: [{ ...copy(1), coverUrl: "https://cdn.test/cover.jpg" }],
    });
    expect(screen.getByAltText("Puzzle 1").className).toContain(
      "object-contain",
    );
  });

  it("lists copies that aren't on offer, minus the ones already in the collection", () => {
    renderPicker({ library: [copy(1), copy(2)], inCollection: [copy(2)] });
    expect(screen.getByText("Puzzle 1")).toBeTruthy();
    expect(screen.queryByText("Puzzle 2")).toBeNull();
  });

  it("points an empty library at Add Puzzle", () => {
    renderPicker({ library: [] });
    expect(screen.getByText("Nothing in your library yet")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Add a puzzle" }).getAttribute("href"),
    ).toBe("/my-puzzles/add");
  });

  it("says when every copy is already in the collection", () => {
    renderPicker({ library: [copy(1)], inCollection: [copy(1)] });
    expect(screen.getByText("Everything is already in here")).toBeTruthy();
    expect(screen.queryByText("Nothing in your library yet")).toBeNull();
  });

  it("says when nothing matches the search", () => {
    renderPicker({ library: [copy(1)] });
    fireEvent.change(screen.getByPlaceholderText("Search"), {
      target: { value: "zebra" },
    });
    expect(screen.getByText("No puzzles match “zebra”")).toBeTruthy();
    expect(screen.queryByText("Nothing in your library yet")).toBeNull();
  });

  it("docks its confirm on a phone once something is picked, where the page head has scrolled away", () => {
    renderPicker({ library: [copy(1)] });
    expect(screen.queryByTestId("picker-footer")).toBeNull();
    selectCard("Puzzle 1");
    const footer = screen.getByTestId("picker-footer");
    expect(footer.classList).toContain("sticky");
    expect(footer.classList).toContain("sm:hidden");
    expect(
      within(footer).getByRole("button", { name: "Add 1 puzzle" }),
    ).toBeTruthy();
    // The head's confirm is for wider screens, and the install tip steps aside meanwhile.
    expect(isSurfaceBusy()).toBe(true);
  });

  it("adds the selected copies and returns to the collection", async () => {
    renderPicker({ library: [copy(1), copy(2)] });
    selectCard("Puzzle 1");
    selectCard("Puzzle 2");
    fireEvent.click(
      within(screen.getByTestId("picker-footer")).getByRole("button", {
        name: "Add 2 puzzles",
      }),
    );

    await waitFor(() => expect(mocks.push).toHaveBeenCalledTimes(1));
    expect(mocks.mutation.mock.calls).toEqual([
      [ADD, { collectionId: "col_agg", copyId: "copy_agg_1" }],
      [ADD, { collectionId: "col_agg", copyId: "copy_agg_2" }],
    ]);
    expect(mocks.push).toHaveBeenCalledWith("/collections/col_doc");
  });

  it("reports copies it couldn't add, keeps them selected and stays", async () => {
    mocks.mutation.mockImplementation(async (_name, args) => {
      if ((args as { copyId: string }).copyId === "copy_agg_2") {
        throw new Error("boom");
      }
      return null;
    });
    renderPicker({ library: [copy(1), copy(2)] });
    selectCard("Puzzle 1");
    selectCard("Puzzle 2");
    fireEvent.click(
      within(screen.getByTestId("picker-footer")).getByRole("button", {
        name: "Add 2 puzzles",
      }),
    );

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(vi.mocked(toast.error).mock.calls[0]?.[0]).toBe(
      "Couldn't add 1 puzzle. It's still selected, so you can try again.",
    );
    expect(mocks.push).not.toHaveBeenCalled();
    // The copy that did go in is no longer selected; the one that failed still is.
    expect(
      within(screen.getByTestId("picker-footer")).getByRole("button", {
        name: "Add 1 puzzle",
      }),
    ).toBeTruthy();
  });
});
