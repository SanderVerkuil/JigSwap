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

// Each collection tile is one link to the collection, with its Edit button beside it (not nested
// inside it) and named after the collection; the default collection has no Edit button.

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
    convexQuery(gateway.identity.byClerkId, { clerkId: "clerk_me" }).queryKey,
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

  it("give the default collection no Edit button", () => {
    renderPage([collection("Favourites", { isDefault: true })]);
    expect(screen.getByText("Favourites").closest("a")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Edit Favourites" }),
    ).toBeNull();
  });
});
