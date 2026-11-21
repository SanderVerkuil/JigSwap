// @vitest-environment happy-dom
// The "-" prefix keeps the TanStack route generator from treating this file as a route.
import { gateway, type Id } from "@/gateway";
import { convexQuery, ConvexQueryClient } from "@convex-dev/react-query";
import type { CollectionView } from "@jigswap/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ConvexReactClient } from "convex/react";
import type { ComponentType, ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../../locales/en.json";
import { Route } from "./index";

// Each collection is a named shelf: its name is one link to the collection, with its Edit button
// beside it (not nested inside it) and named after the collection; the default collection has no
// Edit button. Its newest boxes stand on its shelf, each opening the copy under the collection.

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: object) => ({ options }),
}));
vi.mock("@/compat/clerk", () => ({
  useUser: () => ({ user: { id: "clerk_me" } }),
}));
vi.mock("@/compat/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
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
// The emoji field's localized names load over the network; not needed here.
vi.mock("@/lib/emoji-label", () => ({ useEmojiLabel: () => null }));
vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation: () => vi.fn(),
}));

const ME = "me" as Id<"users">;

const collection = (
  name: string,
  extra: Partial<CollectionView> = {},
): CollectionView => ({
  _id: `doc_${name}`,
  _creationTime: 0,
  aggregateId: `agg_${name}`,
  userId: ME,
  name,
  visibility: "private",
  isDefault: false,
  createdAt: 0,
  updatedAt: 0,
  puzzleCount: 2,
  ...extra,
});

const renderPage = (collections: CollectionView[]) => {
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
  queryClient.setQueryData(
    convexQuery(gateway.identity.currentUser, {}).queryKey,
    { _id: ME },
  );
  queryClient.setQueryData(
    convexQuery(gateway.collections.listForUser, { userId: ME }).queryKey,
    collections,
  );
  const Page = (Route as unknown as { options: { component: ComponentType } })
    .options.component;
  render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <Page />
      </IntlProvider>
    </QueryClientProvider>,
  );
};

afterEach(cleanup);

describe("collection tiles", () => {
  it("link to the collection, with a named Edit button beside the link", () => {
    renderPage([collection("Cats")]);
    const link = screen.getByText("Cats").closest("a");
    expect(link?.getAttribute("href")).toBe("/collections/doc_Cats");
    const edit = screen.getByRole("button", { name: "Edit Cats" });
    expect(link?.contains(edit)).toBe(false);
    // No interactive control is nested inside the link.
    expect(link?.querySelector("button, a, [role=button]")).toBeNull();
  });

  it("open the editor from the Edit button", () => {
    renderPage([collection("Cats")]);
    fireEvent.click(screen.getByRole("button", { name: "Edit Cats" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
      "Cats",
    );
  });

  it("count their puzzles with the right plural", () => {
    renderPage([
      collection("Cats", { puzzleCount: 1 }),
      collection("Dogs", { puzzleCount: 2 }),
    ]);
    expect(screen.getByText("1 puzzle")).toBeTruthy();
    expect(screen.getByText("2 puzzles")).toBeTruthy();
  });

  it("give the default collection no Edit button", () => {
    renderPage([collection("Favourites", { isDefault: true })]);
    expect(screen.getByText("Favourites").closest("a")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Edit Favourites" }),
    ).toBeNull();
  });
});

describe("collection shelves", () => {
  const copy = (id: string, title: string) =>
    ({
      _id: id,
      puzzleId: `p_${id}`,
      ownerId: ME,
      condition: "good",
      availability: { forTrade: false, forSale: false, forLend: false },
      createdAt: 0,
      updatedAt: 0,
      puzzle: null,
      snapshot: { title, pieceCount: 1000 },
    }) as NonNullable<CollectionView["shelf"]>[number];

  it("stand each collection's boxes on its own shelf, opening the copy under the collection", () => {
    renderPage([
      collection("Cats", {
        shelf: [copy("c1", "Kittens"), copy("c2", "Tabby")],
      }),
    ]);
    const shelf = screen.getByRole("list", { name: "Cats" });
    const boxes = Array.from(shelf.querySelectorAll("a"), (a) => [
      a.getAttribute("aria-label"),
      a.getAttribute("href"),
    ]);
    expect(boxes).toEqual([
      ["Kittens", "/my-puzzles/c1?from=collection:doc_Cats"],
      ["Tabby", "/my-puzzles/c2?from=collection:doc_Cats"],
    ]);
  });

  it("invite filling an empty collection, and open one whose boxes weren't sent", () => {
    renderPage([
      collection("Empty", { puzzleCount: 0, shelf: [] }),
      collection("Older", { puzzleCount: 4 }),
    ]);
    expect(
      screen.getByRole("link", { name: "Add Puzzles" }).getAttribute("href"),
    ).toBe("/collections/doc_Empty/add-puzzles");
    expect(
      screen.getByRole("link", { name: "View" }).getAttribute("href"),
    ).toBe("/collections/doc_Older");
    expect(screen.queryByRole("list", { name: "Older" })).toBeNull();
  });
});
