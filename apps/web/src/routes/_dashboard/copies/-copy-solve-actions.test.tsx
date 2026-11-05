// @vitest-environment happy-dom
import { CopyInstanceScreen } from "@/components/copies/copy-instance-screen";
import { gateway, type Id } from "@/gateway";
import { convexQuery, ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ConvexReactClient } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../../locales/en.json";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children?: ReactNode }) => <a>{children}</a>,
}));
vi.mock("@/compat/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/compat/link", () => ({
  Link: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation: () => vi.fn(),
}));

type CopyView = NonNullable<
  FunctionReturnType<typeof gateway.library.getCopyInstanceView>
>;

const anna = {
  _id: "u_anna",
  _creationTime: 0,
  name: "Anna",
  isActive: true,
  createdAt: 0,
  updatedAt: 0,
};

// Anna's copy, lent out: closed for offers, so a non-owner sees no request button.
const copyView = (fields: Partial<CopyView>): CopyView => ({
  copyId: "copy-doc-1",
  puzzleId: "puzzle-1",
  aggregateId: "copy-agg-1",
  viewerIsOwner: false,
  viewerCanManage: false,
  viewerMayRequest: false,
  viewerMayOpenDefinition: true,
  household: null,
  owner: { anonymous: false, member: anna },
  snapshot: {
    title: "Harbour Lights",
    pieceCount: 1000,
    coverImageId: null,
    condition: "good",
    availability: { forTrade: false, forSale: false, forLend: false },
    visibility: "visible",
    tags: [],
  },
  acquiredByViewerAt: null,
  since: [],
  before: [],
  completions: [],
  loans: [],
  transfers: [],
  copyReviews: [],
  stats: {
    timesCompleted: 0,
    fastestFinishMinutes: null,
    timesLentOut: 1,
    yourCopyRating: null,
  },
  community: {
    rating: 0,
    count: 0,
    breakdown: [0, 0, 0, 0, 0],
    percentages: [0, 0, 0, 0, 0],
  },
  gallery: [],
  pendingPhotos: [],
  photoLimit: 12,
  ...fields,
});

const renderCopy = (view: CopyView) => {
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
    convexQuery(gateway.library.getCopyInstanceView, {
      copyId: "copy-doc-1" as Id<"ownedPuzzles">,
    }).queryKey,
    view,
  );
  queryClient.setQueryData(
    convexQuery(gateway.solving.completionHistory, { copyId: "copy-agg-1" })
      .queryKey,
    [],
  );
  render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <CopyInstanceScreen copyId="copy-doc-1" owned={false} />
      </IntlProvider>
    </QueryClientProvider>,
  );
};

const button = (name: string) => screen.queryByRole("button", { name });

afterEach(cleanup);

describe("copy page solve actions", () => {
  it("lets the borrower who holds the copy start or log a solve, and still message the owner", () => {
    renderCopy(copyView({ viewerHoldsCopy: true }));
    expect(button("Start puzzle")).not.toBeNull();
    expect(button("Log a solve")).not.toBeNull();
    expect(button("Message")).not.toBeNull();
    // Borrowing does not make it theirs to manage.
    expect(button("Edit")).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("doesn't offer a borrower a request for the copy they already hold, even while it stays on offer", () => {
    const onOffer = {
      ...copyView({}).snapshot,
      availability: { forTrade: true, forSale: true, forLend: true },
    };
    renderCopy(
      copyView({
        snapshot: onOffer,
        viewerHoldsCopy: true,
        viewerMayRequest: true,
      }),
    );
    expect(button(en.tradeRequest.cta.mixed)).toBeNull();
    // A view-only seat's explanation of why it can't request goes with the button.
    expect(
      screen.queryByText(en.copyInstance.actions.requestViewOnly),
    ).toBeNull();
    expect(button("Start puzzle")).not.toBeNull();
    expect(button("Message")).not.toBeNull();
    cleanup();

    renderCopy(
      copyView({
        snapshot: onOffer,
        viewerHoldsCopy: true,
        viewerMayRequest: false,
      }),
    );
    expect(button(en.tradeRequest.cta.mixed)).toBeNull();
    expect(
      screen.queryByText(en.copyInstance.actions.requestViewOnly),
    ).toBeNull();
    expect(button("Message")).not.toBeNull();
  });

  it("keeps the request for someone who doesn't hold the copy", () => {
    renderCopy(
      copyView({
        snapshot: {
          ...copyView({}).snapshot,
          availability: { forTrade: false, forSale: false, forLend: true },
        },
        viewerHoldsCopy: false,
        viewerMayRequest: true,
      }),
    );
    expect(button(en.tradeRequest.cta.borrow)).not.toBeNull();
  });

  it("gives someone who does not hold the copy no solve actions, also when the backend predates viewerHoldsCopy", () => {
    for (const view of [
      copyView({ viewerHoldsCopy: false }),
      copyView({}), // an older backend omits the flag
    ]) {
      renderCopy(view);
      expect(button("Start puzzle")).toBeNull();
      expect(button("Log a solve")).toBeNull();
      expect(button("Message")).not.toBeNull();
      cleanup();
    }
  });

  it("keeps the owner's actions as they were: solve and offer, no Message", () => {
    renderCopy(
      copyView({
        viewerIsOwner: true,
        viewerCanManage: true,
        viewerHoldsCopy: false, // lent out, yet still the owner's to solve
      }),
    );
    expect(button("Start puzzle")).not.toBeNull();
    expect(button("Log a solve")).not.toBeNull();
    expect(
      screen.queryByRole("switch", { name: "Offer for swap" }),
    ).not.toBeNull();
    expect(button("Message")).toBeNull();
  });
});

describe("copy page circle sharing", () => {
  const share = en.circles.shareDialog.trigger;

  it("offers the owner Share with circles…, which opens the dialog", () => {
    renderCopy(copyView({ viewerIsOwner: true, viewerCanManage: true }));
    fireEvent.click(screen.getByRole("button", { name: share }));
    expect(
      screen.getByRole("heading", {
        name: "Share “Harbour Lights” with circles",
      }),
    ).toBeTruthy();
  });

  it("offers it to nobody else: circle shares are the owner's alone", () => {
    renderCopy(copyView({ viewerHoldsCopy: true }));
    expect(button(share)).toBeNull();
  });
});
