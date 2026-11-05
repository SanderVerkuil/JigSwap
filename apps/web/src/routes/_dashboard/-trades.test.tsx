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
      incoming: "exchange.incoming",
      outgoing: "exchange.outgoing",
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
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ fn }: { fn: string }) => ({
    data:
      fn === "identity.byClerkId"
        ? { _id: "me" }
        : fn === "exchange.incoming"
          ? data.incoming
          : fn === "exchange.outgoing"
            ? data.outgoing
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
  ExchangeReportMenu: () => null,
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
