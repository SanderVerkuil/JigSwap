// @vitest-environment happy-dom
// The Exchanges page regroups its rows whenever data changes (a new request arrives, a partner
// confirms, the viewer confirms). A row must survive that: what the member has open, what they
// were typing and where their focus is all live inside the row.
import { gateway } from "@/gateway";
import { convexQuery, ConvexQueryClient } from "@convex-dev/react-query";
import type { ExchangeSummaryView } from "@jigswap/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { ConvexReactClient } from "convex/react";
import { getFunctionName } from "convex/server";
import { useState, type ComponentType } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { Route } from "./trades";

const mocks = vi.hoisted(() => ({
  mutation: vi.fn<(name: string, args: unknown) => Promise<unknown>>(),
  search: {} as { exchange?: string },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({
    options,
    useSearch: () => mocks.search,
  }),
  useNavigate: () => vi.fn(),
}));
vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation:
    (ref: Parameters<typeof getFunctionName>[0]) => (args: unknown) =>
      mocks.mutation(getFunctionName(ref), args),
}));
vi.mock("@/compat/clerk", () => ({
  useUser: () => ({ user: { id: "clerk_me" } }),
}));
vi.mock("@/components/dashboard-home/use-current-member", () => ({
  useCurrentMember: () => ({ member: { _id: "u_me" } }),
}));
vi.mock("@/components/dashboard-layout/page-header-slot", () => ({
  usePageHeaderActions: () => {},
}));
vi.mock("@/components/whats-new/tour-launcher", () => ({
  useTourLauncher: () => ({ startTour: vi.fn() }),
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
// These have their own tests; the page test only needs them out of the way.
vi.mock("@/components/tour/guide-help-button", () => ({
  GuideHelpButton: () => null,
}));
vi.mock("@/components/exchange/trade-partner-card", () => ({
  TradePartnerCard: () => null,
}));
vi.mock("@/components/exchange/loans-tab", () => ({ LoansTab: () => null }));
vi.mock("@/components/reputation/leave-review-dialog", () => ({
  LeaveReviewDialog: () => null,
}));
vi.mock("@/components/safety/exchange-report-menu", () => ({
  ExchangeReportMenu: () => null,
}));
// Like the real composer, the thread keeps its draft in local state: a remount loses it.
vi.mock("@/components/messaging/thread-view", () => ({
  ThreadView: function ThreadView() {
    const [draft, setDraft] = useState("");
    return (
      <input
        aria-label="draft"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
    );
  },
}));

const NOW = Date.UTC(2026, 9, 30, 12);

const member = (id: string, name: string) => ({
  _id: id,
  _creationTime: 0,
  name,
  isActive: true,
  createdAt: 0,
  updatedAt: 0,
});
const puzzle = (title: string) => ({
  _id: `p_${title}`,
  _creationTime: 0,
  title,
  pieceCount: 1000,
  status: "approved" as const,
  createdAt: 0,
  updatedAt: 0,
});
const me = member("u_me", "Henk");
const anna = member("u_anna", "Anna");
const bob = member("u_bob", "Bob");

// The viewer asked Anna for her "Harbour Lights".
const harbour = (
  fields: Partial<ExchangeSummaryView> = {},
): ExchangeSummaryView =>
  ({
    _id: "ex_harbour",
    _creationTime: 0,
    aggregateId: "agg-harbour",
    type: "loan",
    requestedPuzzleId: "copy_harbour",
    status: "proposed",
    createdAt: NOW - 3_600_000,
    updatedAt: NOW,
    requester: me,
    owner: anna,
    requesterState: "visible",
    ownerState: "visible",
    requestedOwnedPuzzle: null,
    requestedPuzzle: puzzle("Harbour Lights"),
    offeredOwnedPuzzle: null,
    offeredPuzzle: null,
    ...fields,
  }) as ExchangeSummaryView;

// Bob asks the viewer for their "Tulip Fields": this always waits on the viewer.
const tulipRequest = {
  ...harbour({
    _id: "ex_tulip",
    aggregateId: "agg-tulip",
    requester: bob,
    owner: me,
    requestedPuzzle: puzzle("Tulip Fields"),
    updatedAt: NOW - 1000,
  }),
} as ExchangeSummaryView;

type Seed = { incoming?: unknown[]; outgoing?: unknown[] };

// TanStack Query notifies its observers on a zero timeout.
const flushQueryNotifications = () =>
  new Promise((resolve) => setTimeout(resolve, 0));

const renderPage = ({ incoming = [], outgoing = [] }: Seed) => {
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
  const incomingKey = convexQuery(gateway.exchange.incoming, {}).queryKey;
  const outgoingKey = convexQuery(gateway.exchange.outgoing, {}).queryKey;
  queryClient.setQueryData(
    convexQuery(gateway.identity.byClerkId, { clerkId: "clerk_me" }).queryKey,
    { _id: "u_me" },
  );
  queryClient.setQueryData(incomingKey, incoming as never);
  queryClient.setQueryData(outgoingKey, outgoing as never);
  queryClient.setQueryData(
    convexQuery(gateway.conversation.getThreadByExchange, {
      exchangeId: "agg-harbour",
    }).queryKey,
    "thread_1" as never,
  );

  const Page = (Route as unknown as { options: { component: ComponentType } })
    .options.component;
  render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider
        locale="en"
        messages={en}
        timeZone="Europe/Amsterdam"
        now={new Date(NOW)}
      >
        <Page />
      </IntlProvider>
    </QueryClientProvider>,
  );

  // A live push, as the Convex subscription delivers it.
  const setData = ({ incoming: nextIn, outgoing: nextOut }: Seed) => {
    if (nextIn) queryClient.setQueryData(incomingKey, nextIn as never);
    if (nextOut) queryClient.setQueryData(outgoingKey, nextOut as never);
    return flushQueryNotifications();
  };
  const push = (seed: Seed) => act(() => setData(seed));
  return { push };
};

const harbourToggle = () =>
  screen.getByRole("button", { name: /Harbour Lights/ });

// Opens the row and its inline chat, types a draft and leaves focus in the composer.
const startDraft = () => {
  fireEvent.click(harbourToggle());
  fireEvent.click(screen.getByRole("button", { name: en.trades.message }));
  const draft = screen.getByLabelText("draft") as HTMLInputElement;
  fireEvent.change(draft, { target: { value: "See you Friday" } });
  draft.focus();
  return draft;
};

const expectDraftKept = (draft: HTMLInputElement) => {
  expect(harbourToggle().getAttribute("aria-expanded")).toBe("true");
  expect(
    screen
      .getByRole("button", { name: en.trades.message })
      .getAttribute("aria-expanded"),
  ).toBe("true");
  // The same element, not a fresh mount that happens to look alike.
  expect(screen.getByLabelText("draft")).toBe(draft);
  expect(draft.value).toBe("See you Friday");
  expect(document.activeElement).toBe(draft);
};

// Headings and row titles in the order they read on the page.
const reading = () =>
  [...document.querySelectorAll("h2, button[aria-expanded] .line-clamp-2")].map(
    (node) =>
      node.tagName === "H2"
        ? `# ${node.firstChild?.textContent}`
        : (node.textContent ?? "").replace(/^.* · /, ""),
  );

beforeEach(() => {
  mocks.search = {};
  mocks.mutation.mockReset();
  mocks.mutation.mockResolvedValue(undefined);
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

describe("Exchanges page: regrouping keeps a row as the member left it", () => {
  it("lists what waits on the viewer first, under headings only when something does", async () => {
    const { push } = renderPage({ outgoing: [harbour()] });
    expect(reading()).toEqual(["Harbour Lights"]);

    await push({ incoming: [tulipRequest] });
    expect(reading()).toEqual([
      `# ${en.trades.groups.needsYou}`,
      "Tulip Fields",
      `# ${en.trades.groups.others}`,
      "Harbour Lights",
    ]);
  });

  it("keeps an open row, its chat, the draft and focus when someone else's request arrives", async () => {
    const { push } = renderPage({ outgoing: [harbour()] });
    const draft = startDraft();

    // needsYou goes from empty to non-empty: headings appear around the row.
    await push({ incoming: [tulipRequest] });
    expect(screen.getByRole("heading", { name: /Needs you/ })).not.toBeNull();
    expectDraftKept(draft);

    // And back when that request is gone.
    await push({ incoming: [] });
    expect(screen.queryByRole("heading", { name: /Needs you/ })).toBeNull();
    expectDraftKept(draft);
  });

  it("keeps the row as it is when it moves up into Needs you (the partner accepted)", async () => {
    const { push } = renderPage({
      incoming: [tulipRequest],
      outgoing: [harbour()],
    });
    const draft = startDraft();

    await push({ outgoing: [harbour({ status: "accepted" })] });
    expect(reading()).toEqual([
      `# ${en.trades.groups.needsYou}`,
      "Harbour Lights",
      "Tulip Fields",
    ]);
    expectDraftKept(draft);
  });

  it("keeps the row as it is when it moves down out of Needs you (the partner's confirm settled it)", async () => {
    const { push } = renderPage({
      incoming: [tulipRequest],
      outgoing: [harbour({ status: "accepted" })],
    });
    const draft = startDraft();

    await push({ outgoing: [harbour({ status: "completed" })] });
    expect(reading()).toEqual([
      `# ${en.trades.groups.needsYou}`,
      "Tulip Fields",
      `# ${en.trades.groups.others}`,
      "Harbour Lights",
    ]);
    expectDraftKept(draft);
  });

  it("does not scroll a deep-linked row back into view when the list regroups", async () => {
    mocks.search = { exchange: "agg-harbour" };
    const { push } = renderPage({ outgoing: [harbour()] });
    expect(harbourToggle().getAttribute("aria-expanded")).toBe("true");
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);

    await push({ incoming: [tulipRequest] });
    expect(harbourToggle().getAttribute("aria-expanded")).toBe("true");
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
  });
});
