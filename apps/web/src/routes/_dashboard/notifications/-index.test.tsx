// @vitest-environment happy-dom
// The "-" prefix keeps the TanStack route generator from treating this file as a route.
import type { NotificationView } from "@jigswap/contracts";
import { act, cleanup, render, screen, within } from "@testing-library/react";
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
  usePageHeader: () => {},
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

describe("NotificationsPage phone filter row (UX-122)", () => {
  const renderPage = () => {
    rows.current = [view("one", Date.now())];
    render(
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <NotificationsPage />
      </IntlProvider>,
    );
    return screen.getByRole("group", { name: "Filter by category" });
  };
  const classesOf = (element: Element) => [...element.classList];

  it("puts the category filters in one named row that scrolls sideways below md and wraps from md", () => {
    const group = renderPage();
    expect(classesOf(group)).toContain("max-md:overflow-x-auto");
    const track = within(group).getAllByRole("button")[0].parentElement!;
    expect(classesOf(track)).toEqual(
      expect.arrayContaining(["flex-wrap", "max-md:flex-nowrap"]),
    );
    expect(
      within(group)
        .getAllByRole("button")
        .map((pill) => pill.getAttribute("aria-pressed")),
    ).toContain("true");
  });

  // The chosen category used to be the canal-filled primary button; it is the tab track's white
  // window now, the same selection look as every FilterBar.
  it("marks the chosen category as the tab track's window, not a primary button", () => {
    const group = renderPage();
    const all = within(group).getByRole("button", { name: "All" });
    expect(all.getAttribute("aria-pressed")).toBe("true");
    expect(classesOf(all.parentElement!)).toEqual(
      expect.arrayContaining(["bg-muted", "rounded-lg", "p-[3px]"]),
    );
    expect(classesOf(all)).toEqual(
      expect.arrayContaining(["bg-background", "font-semibold"]),
    );
    for (const pill of within(group).getAllByRole("button")) {
      expect(classesOf(pill)).not.toContain("bg-primary");
    }
  });

  it("keeps the unread-only switch out of the pill row, under it on a phone", () => {
    const group = renderPage();
    expect(within(group).queryByRole("switch")).toBeNull();
    const toggle = screen.getByRole("switch", { name: "Unread only" });
    const controls = group.parentElement!;
    expect(controls.contains(toggle)).toBe(true);
    expect(classesOf(controls)).toEqual(
      expect.arrayContaining(["flex-col", "md:flex-row"]),
    );
  });

  it("lets the aside shrink, so the one-row pills scroll instead of widening the page", () => {
    const group = renderPage();
    expect(classesOf(group.closest("aside")!)).toContain("min-w-0");
  });
});
