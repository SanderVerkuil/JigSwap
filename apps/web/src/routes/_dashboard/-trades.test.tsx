// @vitest-environment happy-dom
// The "-" prefix keeps the TanStack route generator from treating this file as a route.
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import source from "../../../locales/source.json";
import { Route as TradesRoute } from "./trades";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// Only the lifecycle actions under an expanded exchange matter here. Reads are keyed by the gateway
// reference (a plain string in this mock); mutations record what they were called with.
const data = vi.hoisted(() => ({
  incoming: [] as unknown[],
  outgoing: [] as unknown[],
  calls: [] as Array<[string, unknown]>,
}));

vi.mock("@/gateway", () => ({
  gateway: {
    identity: { byClerkId: "identity.byClerkId" },
    exchange: {
      myLive: "exchange.myLive",
      myHistory: "exchange.myHistory",
      mySummary: "exchange.mySummary",
      accept: "exchange.accept",
      decline: "exchange.decline",
      complete: "exchange.complete",
      cancel: "exchange.cancel",
    },
    lending: { borrowed: "lending.borrowed", returnLoan: "lending.returnLoan" },
  },
}));
vi.mock("@convex-dev/react-query", () => ({
  convexQuery: (fn: string, args: unknown) => ({ fn, args }),
  useConvexMutation: (fn: string) => async (args: unknown) => {
    data.calls.push([fn, args]);
  },
}));
vi.mock("convex-helpers/react", () => ({
  usePaginatedQuery: () => ({
    results: [],
    status: "Exhausted",
    loadMore: () => {},
  }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueries: () => [],
  useQuery: ({ fn }: { fn: string }) => ({
    data:
      fn === "identity.byClerkId"
        ? { _id: "me" }
        : fn === "exchange.myLive"
          ? [
              ...data.incoming.map((row) => ({
                ...(row as object),
                userRole: "owner",
              })),
              ...data.outgoing.map((row) => ({
                ...(row as object),
                userRole: "requester",
              })),
            ]
          : undefined,
  }),
  useMutation: ({
    mutationFn,
  }: {
    mutationFn: (args: unknown) => Promise<void>;
  }) => ({ mutateAsync: mutationFn, isPending: false }),
}));
vi.mock("@/compat/clerk", () => ({ useUser: () => ({ user: { id: "u" } }) }));
vi.mock("@/components/dashboard-layout/page-header-slot", () => ({
  usePageHeaderActions: () => {},
}));
vi.mock("@/components/whats-new/tour-launcher", () => ({
  useTourLauncher: () => ({ startTour: () => {} }),
}));
vi.mock("@/components/tour/guide-help-button", () => ({
  GuideHelpButton: () => null,
}));
vi.mock("@/components/dashboard-home/use-current-member", () => ({
  useCurrentMember: () => ({ member: null }),
}));
vi.mock("@/components/exchange/trade-partner-card", () => ({
  TradePartnerCard: () => null,
}));
vi.mock("@/components/reputation/leave-review-dialog", () => ({
  LeaveReviewDialog: () => null,
}));
vi.mock("@/components/safety/exchange-report-menu", () => ({
  ExchangeReportMenu: () => <button aria-label="Trade actions" />,
}));
vi.mock("@/components/messaging/thread-view", () => ({
  ThreadView: () => null,
}));
vi.mock("@/lib/page-title", () => ({ pageTitle: () => "Exchanges" }));
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));

type Status =
  "proposed" | "accepted" | "rejected" | "completed" | "cancelled" | "disputed";

const exchange = (status: Status) => ({
  _id: `row-${status}`,
  aggregateId: `ex-${status}`,
  status,
  type: "sale",
  requestedPuzzle: { title: "Harbour Lights", pieceCount: 1000 },
  requester: { _id: "requester", name: "Rita" },
  owner: { _id: "owner", name: "Olivia" },
  requesterState: "active",
  ownerState: "active",
  createdAt: 0,
  updatedAt: 0,
});

function makeRouter() {
  const rootRoute = createRootRoute({
    component: () => (
      <IntlProvider
        locale="en"
        messages={en}
        timeZone="Europe/Amsterdam"
        now={new Date(0)}
      >
        <Outlet />
      </IntlProvider>
    ),
  });
  const dashboard = createRoute({
    getParentRoute: () => rootRoute,
    id: "_dashboard",
    component: Outlet,
  });
  // Attach the real file route the way routeTree.gen does, so its useSearch resolves.
  const trades = TradesRoute.update({
    id: "/trades",
    path: "/trades",
    getParentRoute: () => dashboard,
  } as never);
  return createRouter({
    routeTree: rootRoute.addChildren([dashboard.addChildren([trades])]),
    history: createMemoryHistory({ initialEntries: ["/trades"] }),
  });
}

const buttonNamed = (name: string) =>
  Array.from(document.querySelectorAll("button")).find(
    (button) => button.textContent?.trim() === name,
  );

// The whole row is one toggle; it is the only expandable control until the row is open.
const rowToggle = () =>
  document.querySelector<HTMLButtonElement>("button[aria-expanded]");

const confirmDialog = () => document.querySelector('[role="alertdialog"]');

let container: HTMLDivElement | undefined;
let root: Root | undefined;

// Render the page with one exchange in the given direction and expand it.
const openExchange = async (
  direction: "incoming" | "outgoing",
  status: Status,
) => {
  data.incoming = direction === "incoming" ? [exchange(status)] : [];
  data.outgoing = direction === "outgoing" ? [exchange(status)] : [];
  data.calls = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const router = makeRouter();
  await act(async () => {
    root?.render(<RouterProvider router={router} />);
  });
  await vi.waitFor(() => expect(rowToggle()).not.toBeNull());
  await act(async () => {
    rowToggle()?.click();
  });
};

const actions = () =>
  [
    en.trades.accept,
    en.trades.decline,
    en.trades.markComplete,
    en.trades.cancel,
  ].filter((name) => buttonNamed(name) !== undefined);

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
});

describe("exchange actions", () => {
  // Accepting sets the puzzle aside for this one exchange, so the owner must be able to back out,
  // but calling off an agreed deal is final, so it asks first and says what happens.
  it("lets the owner cancel an accepted exchange once they confirm", async () => {
    await openExchange("incoming", "accepted");
    expect(actions()).toEqual([en.trades.markComplete, en.trades.cancel]);
    await act(async () => {
      buttonNamed(en.trades.cancel)?.click();
    });
    expect(data.calls).toEqual([]);
    expect(confirmDialog()?.textContent).toContain(
      en.trades.cancelAccepted.body,
    );
    await act(async () => {
      buttonNamed(en.trades.cancelAccepted.confirm)?.click();
    });
    expect(data.calls).toEqual([
      ["exchange.cancel", { exchangeId: "ex-accepted" }],
    ]);
  });

  it("has the confirm's copy in every locale file", () => {
    expect(source.trades.cancelAccepted).toEqual(en.trades.cancelAccepted);
    expect(Object.keys(nl.trades.cancelAccepted).sort()).toEqual(
      Object.keys(en.trades.cancelAccepted).sort(),
    );
  });

  it("keeps an accepted exchange when the member backs out of the confirm", async () => {
    await openExchange("outgoing", "accepted");
    await act(async () => {
      buttonNamed(en.trades.cancel)?.click();
    });
    await act(async () => {
      buttonNamed(en.trades.cancelAccepted.keep)?.click();
    });
    expect(confirmDialog()).toBeNull();
    expect(data.calls).toEqual([]);
  });

  it("lets the requester cancel an accepted exchange", async () => {
    await openExchange("outgoing", "accepted");
    expect(actions()).toEqual([en.trades.markComplete, en.trades.cancel]);
  });

  it("offers a pending request's owner accept and decline, not cancel", async () => {
    await openExchange("incoming", "proposed");
    expect(actions()).toEqual([en.trades.accept, en.trades.decline]);
  });

  // With its label, the ⋯ wrapped alone onto a row of its own on a phone.
  it("keeps Message's name when it goes icon-only on a phone", async () => {
    await openExchange("incoming", "proposed");
    const button = buttonNamed(en.trades.message);
    expect(button?.querySelector("span")?.classList).toContain(
      "max-sm:sr-only",
    );
    expect(button?.querySelector("svg")).toBeTruthy();
  });

  // Too narrow for one row, the ⋯ must not wrap alone: it goes with Message, at either end of the
  // next row.
  it("keeps the ⋯ with Message when the actions wrap", async () => {
    await openExchange("incoming", "accepted");
    const message = buttonNamed(en.trades.message);
    const menu = document.querySelector('[aria-label="Trade actions"]');
    expect(menu?.parentElement).toBe(message?.parentElement);
    expect(message?.parentElement?.classList).toContain("flex-1");
  });

  // The label says it all, and without the icons Mark complete + Cancel + Message + ⋯ fit one row
  // from 360px, and Accepteren + Afwijzen + Bericht + ⋯ too.
  it("drops the lifecycle buttons' icons on a phone, not Message's or the ⋯'s", async () => {
    await openExchange("incoming", "accepted");
    const complete = buttonNamed(en.trades.markComplete);
    const row = complete?.parentElement;
    expect(row?.classList).toContain("max-sm:[&>button>svg]:hidden");
    expect(buttonNamed(en.trades.cancel)?.parentElement).toBe(row);
    expect(buttonNamed(en.trades.message)?.parentElement).not.toBe(row);
  });

  it("lets the requester cancel a pending request", async () => {
    await openExchange("outgoing", "proposed");
    expect(actions()).toEqual([en.trades.cancel]);
  });

  it.each<Status>(["completed", "cancelled", "rejected", "disputed"])(
    "offers no lifecycle action once %s",
    async (status) => {
      await openExchange("incoming", status);
      expect(actions()).toEqual([]);
    },
  );
});
