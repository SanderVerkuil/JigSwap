// @vitest-environment happy-dom
// The "-" prefix keeps the TanStack route generator from treating this file as a route.
import {
  PageHeaderSlotProvider,
  usePageHeaderContent,
} from "@/components/dashboard-layout/page-header-slot";
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
} from "@testing-library/react";
import { ConvexReactClient } from "convex/react";
import { getFunctionName } from "convex/server";
import type { ComponentType, ReactNode } from "react";
import { toast } from "sonner";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../../../locales/en.json";
import { Route } from "./index";

// A collection's page: only its owner gets the controls that change it; a visitor of a public
// collection sees its contents without them.

const mocks = vi.hoisted(() => ({
  mutation: vi.fn<(name: string, args: unknown) => Promise<unknown>>(),
  push: vi.fn(),
  member: null as { _id: string } | null,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: object) => ({
    options,
    useParams: () => ({ id: "col_doc" }),
  }),
  useLocation: (opts?: {
    select?: (location: { pathname: string }) => unknown;
  }) => {
    const location = { pathname: "/collections/col_doc" };
    return opts?.select ? opts.select(location) : location;
  },
}));
vi.mock("@/compat/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));
vi.mock("@/compat/link", () => ({
  Link: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/components/dashboard-home/use-current-member", () => ({
  useCurrentMember: () => ({ member: mocks.member, isMemberLoading: false }),
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
vi.mock("@/components/ui/collection-dropdown", () => ({
  CollectionMenuItems: () => null,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const REMOVE = getFunctionName(gateway.collections.removeOwnedPuzzle);
const ADD = getFunctionName(gateway.collections.addOwnedPuzzle);

const OWNER = "owner" as Id<"users">;

const copy: OwnedCopyView = {
  _id: "copy_doc_1",
  aggregateId: "copy_agg_1",
  puzzleId: "puzzle_1",
  ownerId: OWNER,
  condition: "good",
  availability: { forTrade: false, forLend: false, forSale: false },
  visibility: "visible",
  coverUrl: "https://cdn.test/cover.jpg",
  createdAt: 0,
  updatedAt: 0,
  puzzle: {
    _id: "puzzle_1",
    title: "Puzzle 1",
    pieceCount: 1000,
    createdAt: 0,
    updatedAt: 0,
  },
};

const collection: CollectionDetailView = {
  _id: "col_doc",
  _creationTime: 0,
  aggregateId: "col_agg",
  userId: OWNER,
  name: "Cats",
  visibility: "public",
  isDefault: false,
  createdAt: 0,
  updatedAt: 0,
  puzzles: [copy],
  hasMorePuzzles: false,
};

// `null` is what the server returns for a missing or private collection; "unreadable" fails the read
// (a malformed id).
const renderPage = (
  viewer: string,
  shown: CollectionDetailView | null | "unreadable" = collection,
) => {
  mocks.member = { _id: viewer };
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
  if (shown !== "unreadable") {
    queryClient.setQueryData(
      convexQuery(gateway.collections.byId, {
        collectionId: "col_doc" as Id<"collections">,
      }).queryKey,
      shown,
    );
  }
  const Page = (Route as unknown as { options: { component: ComponentType } })
    .options.component;
  render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <PageHeaderSlotProvider>
          <Page />
          <PublishedTitle />
        </PageHeaderSlotProvider>
      </IntlProvider>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  mocks.mutation.mockReset().mockResolvedValue(null);
  mocks.push.mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
});

const removeViaMenu = () => {
  fireEvent.pointerDown(screen.getByRole("button", { name: /^Actions for/ }), {
    button: 0,
    ctrlKey: false,
  });
  fireEvent.click(
    screen.getByRole("menuitem", { name: "Remove from this collection" }),
  );
};

type ToastAction = { action?: { label: string; onClick: () => void } };
afterEach(cleanup);

// What the page published into the shell's page head.
function PublishedTitle() {
  const { title, titleInContent, mobileTitle, crumbs, actions } =
    usePageHeaderContent();
  return (
    <output data-testid="head">
      {JSON.stringify({
        title,
        titleInContent,
        mobileTitle,
        crumbs,
        actions: actions ? "some" : undefined,
      })}
    </output>
  );
}
const head = () => JSON.parse(screen.getByTestId("head").textContent ?? "");

describe("a collection that can't be shown", () => {
  it.each([
    ["is missing or private", null],
    ["has an unreadable id", "unreadable"],
  ] as const)(
    "says so when it %s, with the way back to Collections",
    async (_, shown) => {
      renderPage(OWNER, shown);
      const back = await screen.findByRole("link", {
        name: "Back to Collections",
      });
      expect(back.getAttribute("href")).toBe("/collections");
      expect(screen.getByText(en.collections.notFoundSub)).toBeTruthy();
      expect(screen.queryByText(en.common.loading)).toBeNull();
      // The title is the page head's (its h1), with no trail and nothing to do.
      expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
      await waitFor(() =>
        expect(head()).toEqual({ title: "Collection not found", crumbs: [] }),
      );
    },
  );
});

describe("the collection's name", () => {
  it("shows once at each width: the hero's h1, kept as the crumb's leaf, not in the top bar", () => {
    renderPage(OWNER);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Cats");
    expect(head()).toEqual({
      title: "Cats",
      titleInContent: true,
      mobileTitle: "Collections",
    });
  });
});

describe("the page on a phone", () => {
  // happy-dom has no layout: these pin the class contract; the geometry was checked in a browser.
  it("keeps the stats in a plain two-column grid, not a wrapping divided row", () => {
    renderPage(OWNER);
    const stats = screen.getByText("Pieces Total").closest("dl");
    expect(stats?.classList).toContain("grid-cols-2");
    expect(stats?.classList).toContain("sm:divide-x");
    expect(stats?.classList).not.toContain("divide-x");
  });
});

describe("collection page controls", () => {
  it("says only the newest members are shown when the server left older ones out", () => {
    renderPage(OWNER, { ...collection, hasMorePuzzles: true });
    expect(
      screen.getByText(en.collections.newestOnly.replace("{count}", String(1))),
    ).toBeTruthy();
    expect(screen.getByText("1+")).toBeTruthy();
  });

  it("shows the plain count when nothing was left out", () => {
    renderPage(OWNER);
    expect(screen.queryByText("1+")).toBeNull();
    expect(screen.getByText("1 puzzle")).toBeTruthy();
  });

  it("gives the owner Edit, Add Puzzles and a ⋯ menu on each card", () => {
    renderPage(OWNER);
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Add Puzzles" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Actions for/ })).toBeTruthy();
  });

  it("gives a visitor of a public collection none of them", () => {
    renderPage("visitor");
    expect(screen.getByText("Puzzle 1")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Add Puzzles" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Actions for/ })).toBeNull();
  });
});

describe("where a card leads", () => {
  it("shows the whole box, as My Puzzles does", () => {
    renderPage(OWNER);
    expect(screen.getByAltText("Puzzle 1").className).toContain(
      "object-contain",
    );
  });

  it("opens the owner's own copy on /my-puzzles, keeping the collection as context", () => {
    renderPage(OWNER);
    expect(
      screen.getByText("Puzzle 1").closest("a")?.getAttribute("href"),
    ).toBe("/my-puzzles/copy_doc_1?from=collection:col_doc");
  });

  it("opens a visitor on the public copy page", () => {
    renderPage("visitor");
    expect(
      screen.getByText("Puzzle 1").closest("a")?.getAttribute("href"),
    ).toBe("/copies/copy_doc_1?from=collection:col_doc");
  });
});

describe("removing a puzzle from the collection", () => {
  it("takes it out, confirms with a toast, and Undo puts it back", async () => {
    renderPage(OWNER);
    removeViaMenu();

    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    expect(mocks.mutation.mock.calls).toEqual([
      [REMOVE, { collectionId: "col_agg", copyId: "copy_agg_1" }],
    ]);
    const [message, options] = vi.mocked(toast.success).mock.calls[0] as [
      string,
      ToastAction,
    ];
    expect(message).toBe("Removed “Puzzle 1” from this collection");
    expect(options.action?.label).toBe("Undo");

    options.action?.onClick();
    await waitFor(() => expect(mocks.mutation).toHaveBeenCalledTimes(2));
    expect(mocks.mutation.mock.calls[1]).toEqual([
      ADD,
      { collectionId: "col_agg", copyId: "copy_agg_1" },
    ]);
  });

  it("says so when the removal fails", async () => {
    mocks.mutation.mockRejectedValue(new Error("offline"));
    renderPage(OWNER);
    removeViaMenu();
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Couldn't take the puzzle out of this collection. Please try again.",
      ),
    );
    expect(toast.success).not.toHaveBeenCalled();
  });
});
