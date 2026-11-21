// @vitest-environment happy-dom
import { gateway } from "@/gateway";
import type { MyLibraryCopyView } from "@jigswap/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { HouseholdShelf } from "./household-shelf";

// The household's shelf reads only its newest few boxes, whatever the list below is filtered to,
// and opens the viewer's own copies as theirs and a housemate's as that copy.

const mocks = vi.hoisted(() => ({
  rows: [] as MyLibraryCopyView[],
  asked: [] as Array<[string, unknown]>,
}));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: (options: { queryKey: unknown[] }) => {
    mocks.asked.push([options.queryKey[1] as string, options.queryKey[2]]);
    return { data: { rows: mocks.rows, hasMore: false, matched: 0, total: 0 } };
  },
}));
vi.mock("@/compat/link", () => ({
  Link: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children?: ReactNode;
    [prop: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const copy = (id: string, title: string, ownerId: string) =>
  ({
    _id: id,
    puzzleId: `p_${id}`,
    ownerId,
    condition: "good",
    availability: { forTrade: false, forLend: false, forSale: false },
    createdAt: 1,
    updatedAt: 1,
    puzzle: null,
    snapshot: { title, pieceCount: 1000 },
  }) as MyLibraryCopyView;

const renderShelf = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <HouseholdShelf viewerId="me" label="The household's shelf" />
      </IntlProvider>
    </QueryClientProvider>,
  );

afterEach(() => {
  cleanup();
  mocks.asked = [];
});

describe("HouseholdShelf", () => {
  it("reads the household's newest six and opens each copy by whose it is", () => {
    mocks.rows = [copy("c1", "Lam Gelegd", "me"), copy("c2", "Molen", "bob")];
    renderShelf();
    expect(mocks.asked).toEqual([
      [getFunctionName(gateway.library.myLibraryWindow), { limit: 6 }],
    ]);
    const shelf = screen.getByRole("list", { name: "The household's shelf" });
    expect(
      within(shelf)
        .getAllByRole("link")
        .map((a) => [a.getAttribute("aria-label"), a.getAttribute("href")]),
    ).toEqual([
      ["Lam Gelegd", "/my-puzzles/c1"],
      ["Molen", "/copies/c2"],
    ]);
  });

  it("stands nothing up for a household without puzzles", () => {
    mocks.rows = [];
    const { container } = renderShelf();
    expect(container.innerHTML).toBe("");
  });
});
