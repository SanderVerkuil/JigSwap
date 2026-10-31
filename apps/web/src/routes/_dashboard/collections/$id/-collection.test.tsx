// @vitest-environment happy-dom
// The "-" prefix keeps the TanStack route generator from treating this file as a route.
import { gateway, type Id } from "@/gateway";
import { convexQuery, ConvexQueryClient } from "@convex-dev/react-query";
import type { CollectionDetailView, OwnedCopyView } from "@jigswap/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { ConvexReactClient } from "convex/react";
import { getFunctionName } from "convex/server";
import type { ComponentType, ReactNode } from "react";
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
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const OWNER = "owner" as Id<"users">;

const copy: OwnedCopyView = {
  _id: "copy_doc_1",
  aggregateId: "copy_agg_1",
  puzzleId: "puzzle_1",
  ownerId: OWNER,
  condition: "good",
  availability: { forTrade: false, forLend: false, forSale: false },
  visibility: "visible",
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
};

const renderPage = (viewer: string) => {
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
        queryFn: () => new Promise<never>(() => {}),
      },
    },
  });
  queryClient.setQueryData(
    convexQuery(gateway.collections.byId, {
      collectionId: "col_doc" as Id<"collections">,
    }).queryKey,
    collection,
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

beforeEach(() => {
  mocks.mutation.mockReset().mockResolvedValue(null);
  mocks.push.mockReset();
});
afterEach(cleanup);

describe("collection page controls", () => {
  it("gives the owner Edit", () => {
    renderPage(OWNER);
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
  });

  it("gives a visitor of a public collection no Edit", () => {
    renderPage("visitor");
    expect(screen.getByText("Puzzle 1")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });
});
