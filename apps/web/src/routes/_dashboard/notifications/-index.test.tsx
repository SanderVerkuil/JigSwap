// @vitest-environment happy-dom
// The "-" prefix keeps the TanStack route generator from treating this file as a route.
import type { NotificationView } from "@jigswap/contracts";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../../locales/en.json";
import { Route } from "./index";

const rows = vi.hoisted(() => ({ current: [] as { id: string }[] }));

vi.mock("@/compat/clerk", () => ({ useUser: () => ({ user: { id: "u1" } }) }));
vi.mock("convex/react", () => ({
  usePaginatedQuery: () => ({
    results: rows.current,
    status: "Exhausted",
    loadMore: () => {},
  }),
}));
// Unread count and the admin flag: no unread rows, not an admin.
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: () => ({ data: 0 }),
  useMutation: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation: () => vi.fn(),
}));
vi.mock("@/components/dashboard-layout/page-header-slot", () => ({
  usePageHeaderActions: () => {},
}));
vi.mock("@/lib/web-push", () => ({
  pushSupported: () => false,
  currentSubscriptionEndpoint: () => Promise.resolve(null),
}));
// Only the date sections matter here, not how a row renders.
vi.mock("@/components/notifications/notification-item", () => ({
  NotificationItem: ({ view }: { view: NotificationView }) => (
    <li>{view.id}</li>
  ),
}));

const NotificationsPage = Route.options.component as ComponentType;

const view = (id: string, createdAt: number) =>
  ({
    id,
    type: "follow_request",
    isRead: true,
    createdAt,
  }) as unknown as NotificationView;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("NotificationsPage date sections (UX-183)", () => {
  it("moves a row from Today to Yesterday when midnight passes with the page open", () => {
    vi.useFakeTimers({ now: new Date(2026, 9, 29, 23, 58) });
    rows.current = [
      view("late-evening", new Date(2026, 9, 29, 22, 0).getTime()),
    ];
    render(
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <NotificationsPage />
      </IntlProvider>,
    );
    expect(screen.getByRole("heading", { name: "Today" })).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(3 * 60_000);
    });

    expect(screen.queryByRole("heading", { name: "Today" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Yesterday" })).toBeTruthy();
  });
});
