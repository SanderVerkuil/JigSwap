// @vitest-environment happy-dom
import { MY_SHELF_SIZE } from "@/components/dashboard-home/shelf-section";
import { gateway, type Id } from "@/gateway";
import { convexQuery, ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { ConvexReactClient } from "convex/react";
import { getFunctionName, type FunctionReturnType } from "convex/server";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import type { Member } from "./member-view";
import { ProfileShelfSection } from "./shelf-section";

// The own-profile shelf falls back to the newest copies from library.myShelf when the member has
// not curated it, and never subscribes to the whole library while the arrange dialog is closed
// (PERF-B5q).

vi.mock("@/compat/link", () => ({
  Link: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

// The WebGL plank is out of scope here: render the box titles it was handed.
vi.mock("@/components/common/puzzle-plank-3d", () => ({
  PuzzlePlank3D: ({ boxes }: { boxes: { title?: string }[] }) => (
    <ul aria-label="plank">
      {boxes.map((box, i) => (
        <li key={i}>{box.title}</li>
      ))}
    </ul>
  ),
}));

type Shelf = FunctionReturnType<typeof gateway.library.myShelf>;
type Copy = Shelf["recent"][number];

const ME = "me" as Id<"users">;

const member: Member = {
  _id: ME,
  _creationTime: 0,
  clerkId: "clerk_me",
  name: "Ann Example",
  isActive: true,
  createdAt: 0,
  updatedAt: 0,
};

const copy = (title: string): Copy => ({
  _id: `copy_${title}`,
  puzzleId: `puzzle_${title}`,
  ownerId: ME,
  condition: "good",
  availability: { forTrade: false, forSale: false, forLend: false },
  createdAt: 0,
  updatedAt: 0,
  puzzle: {
    _id: `puzzle_${title}`,
    title,
    pieceCount: 1000,
    createdAt: 0,
    updatedAt: 0,
  },
  coverUrl: null,
});

const renderShelf = ({
  recent,
  featured = [],
}: {
  recent: Copy[];
  featured?: Copy[];
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
        queryFn: () => new Promise<never>(() => {}),
      },
    },
  });
  const set = (key: readonly unknown[], data: unknown) =>
    queryClient.setQueryData(key, data);
  set(convexQuery(gateway.identity.currentUser, {}).queryKey, member);
  set(convexQuery(gateway.library.myShelf, { limit: MY_SHELF_SIZE }).queryKey, {
    total: 40,
    forTrade: 3,
    recent,
  } satisfies Shelf);
  set(
    convexQuery(gateway.social.featuredShelf, { userId: ME }).queryKey,
    featured,
  );
  render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <ProfileShelfSection member={member} />
      </IntlProvider>
    </QueryClientProvider>,
  );
  return queryClient
    .getQueryCache()
    .getAll()
    .map((query) => query.queryKey[1]);
};

const plankTitles = () =>
  within(screen.getByRole("list", { name: "plank" }))
    .getAllByRole("listitem")
    .map((item) => item.textContent);

afterEach(cleanup);

describe("ProfileShelfSection", () => {
  it("falls back to the newest copies from the shelf read when uncurated", () => {
    const recent = ["A", "B", "C", "D", "E", "F"].map(copy);
    const subscribed = renderShelf({ recent });

    expect(screen.getByText("Ann's Shelf")).toBeTruthy();
    expect(screen.getByText("6 on display")).toBeTruthy();
    expect(plankTitles()).toEqual(["A", "B", "C", "D", "E", "F"]);
    expect(subscribed).toContain(getFunctionName(gateway.library.myShelf));
    expect(subscribed).not.toContain(
      getFunctionName(gateway.library.ownedByOwner),
    );
  });

  it("shows the curated shelf when there is one", () => {
    renderShelf({
      recent: ["A", "B"].map(copy),
      featured: ["Picked 1", "Picked 2"].map(copy),
    });
    expect(plankTitles()).toEqual(["Picked 1", "Picked 2"]);
  });

  it("invites the first puzzle when the member owns none", () => {
    renderShelf({ recent: [] });
    expect(
      screen.getByRole("link", { name: "Add Your First Puzzle" }),
    ).toBeTruthy();
  });
});
