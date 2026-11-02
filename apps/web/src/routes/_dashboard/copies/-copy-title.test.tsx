// @vitest-environment happy-dom
// The "-" prefix keeps the TanStack route generator from treating this file as a route.
// UX-157: the copy page publishes its title to the shell page head, so the body's h1 shows only
// below md, where that head is hidden.
import { CopyInstanceScreen } from "@/components/copies/copy-instance-screen";
import type { CopyInstanceView } from "@jigswap/contracts";
import { cleanup, render, screen } from "@testing-library/react";
import { getFunctionName, type FunctionReference } from "convex/server";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../../locales/en.json";

const mocks = vi.hoisted(() => ({
  header: undefined as { title?: unknown } | undefined,
}));

const copy = {
  copyId: "copy_1",
  aggregateId: "aggregate_1",
  puzzleId: "puzzle_1",
  viewerIsOwner: false,
  viewerCanManage: false,
  viewerMayRequest: false,
  household: null,
  owner: { anonymous: true },
  completions: [],
  copyReviews: [],
  loans: [],
  transfers: [],
  pendingPhotos: [],
  gallery: [],
  stats: { timesCompleted: 0, timesLentOut: 0 },
  community: {
    count: 0,
    rating: null,
    label: null,
    breakdown: [],
    percentages: [],
  },
  snapshot: {
    title: "The Night Watch",
    pieceCount: 1000,
    availability: { forTrade: false, forSale: false, forLend: false },
    tags: [],
    condition: "good",
    visibility: "visible",
  },
} as unknown as CopyInstanceView;

vi.mock("@/compat/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/compat/link", () => ({
  Link: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => vi.fn(),
}));
vi.mock("@convex-dev/react-query", () => ({
  convexQuery: (ref: FunctionReference<"query">, args: unknown) => ({
    name: getFunctionName(ref),
    args,
  }),
  useConvexMutation: () => vi.fn(),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ name }: { name: string }) => ({
    data: name.endsWith("getCopyInstanceView") ? copy : undefined,
    isPending: false,
    isError: false,
  }),
  useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/components/dashboard-layout/page-header-slot", () => ({
  usePageHeader: (factory: () => { title?: unknown }) => {
    mocks.header = factory();
  },
}));

afterEach(cleanup);

describe("Copy page title", () => {
  it("shows the body h1 only where the shell page head is hidden", () => {
    render(
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <CopyInstanceScreen copyId="copy_1" owned={false} />
      </IntlProvider>,
    );
    expect(mocks.header?.title).toBe("The Night Watch");
    const heading = screen.getByRole("heading", {
      level: 1,
      name: "The Night Watch",
    });
    expect(heading.className.split(/\s+/)).toContain("md:hidden");
  });
});

describe("Copy page tab title", () => {
  it("names the puzzle, so several open tabs can be told apart", () => {
    render(
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <CopyInstanceScreen copyId="copy_1" owned={false} />
      </IntlProvider>,
    );
    expect(document.title).toBe("The Night Watch — JigSwap");
  });
});

describe("Copy page community rating", () => {
  const renderScreen = () =>
    render(
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <CopyInstanceScreen copyId="copy_1" owned={false} />
      </IntlProvider>,
    );

  it("says nobody has rated it instead of a 0 over five empty bars", () => {
    renderScreen();
    expect(screen.getByText(en.copyInstance.noRatings)).toBeTruthy();
    expect(screen.queryByText("0 community ratings")).toBeNull();
    expect(screen.queryByText("5★")).toBeNull();
  });

  it("shows the score and histogram once someone has", () => {
    const unrated = copy.community;
    copy.community = {
      ...unrated,
      count: 1,
      rating: 4,
      breakdown: [0, 1, 0, 0, 0],
      percentages: [0, 100, 0, 0, 0],
    } as CopyInstanceView["community"];
    try {
      renderScreen();
      expect(screen.queryByText(en.copyInstance.noRatings)).toBeNull();
      expect(screen.getByText("1 community rating")).toBeTruthy();
      expect(screen.getByText("5★")).toBeTruthy();
    } finally {
      copy.community = unrated;
    }
  });
});
