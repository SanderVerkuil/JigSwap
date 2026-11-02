// @vitest-environment happy-dom
import { gateway } from "@/gateway";
import { convexQuery, ConvexQueryClient } from "@convex-dev/react-query";
import type { NotificationView } from "@jigswap/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { ConvexReactClient } from "convex/react";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { NotificationBell } from "./notification-bell";

vi.mock("@/compat/clerk", () => ({
  useUser: () => ({ user: { id: "user_me" } }),
}));

vi.mock("@/compat/link", () => ({
  Link: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children?: ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// A plain row link: these tests are about the popover's focus order, not the row itself.
vi.mock("./notification-item", () => ({
  NotificationItem: ({ view }: { view: NotificationView }) => (
    <li>
      <a href={view.href ?? undefined}>Row {view.id}</a>
    </li>
  ),
}));

// The badge is read-only here; the bell's mutations are never fired.
vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation: () => () => Promise.resolve(null),
}));

afterEach(cleanup);

const row = (id: string): NotificationView => ({
  id,
  type: "new_follower",
  isRead: false,
  createdAt: 0,
  actors: [],
  actorCount: 1,
  context: {},
  href: `/members/${id}`,
  state: "informational",
  availableActions: [],
});

// Render the closed bell with the unread count seeded in the query cache; nothing reaches a server.
const renderBell = (
  unread: number,
  locale: "en" | "nl" = "en",
  rows?: NotificationView[],
) => {
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
    convexQuery(gateway.notifications.unreadCount, {}).queryKey,
    unread,
  );
  // Leaving the rows unset keeps the preview loading (the queryFn never resolves).
  if (rows) {
    queryClient.setQueryData(
      convexQuery(gateway.notifications.listViews, {
        paginationOpts: { numItems: 6, cursor: null },
      }).queryKey,
      { page: rows, isDone: true, continueCursor: "" },
    );
  }
  return render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider
        locale={locale}
        messages={locale === "en" ? en : nl}
        timeZone="Europe/Amsterdam"
      >
        <NotificationBell />
      </IntlProvider>
    </QueryClientProvider>,
  );
};

describe("NotificationBell trigger name", () => {
  it("is just 'Notifications' with nothing unread", () => {
    renderBell(0);
    expect(screen.getByRole("button", { name: "Notifications" })).toBeTruthy();
  });

  it.each([
    [2, "en", "Notifications, 2 unread", "2"],
    [7, "en", "Notifications, 7 unread", "7"],
    // 100 is the backend's cap: past 99 the count is a lower bound.
    [100, "en", "Notifications, 99+ unread", "99+"],
    [140, "en", "Notifications, 99+ unread", "99+"],
    [5, "nl", "Meldingen, 5 ongelezen", "5"],
    [100, "nl", "Meldingen, 99+ ongelezen", "99+"],
  ] as const)(
    "carries the visible count %s (%s)",
    (unread, locale, name, visible) => {
      renderBell(unread, locale);
      const button = screen.getByRole("button", { name });
      // The visible badge text is part of the name (WCAG 2.5.3) and the badge
      // itself is hidden so the count isn't read twice.
      const badge = Array.from(button.querySelectorAll("[aria-hidden]")).find(
        (el) => el.textContent === visible,
      );
      expect(badge).toBeTruthy();
      expect(badge?.hasAttribute("aria-label")).toBe(false);
    },
  );
});

describe("NotificationBell popover", () => {
  const open = async (rows?: NotificationView[]) => {
    renderBell(2, "en", rows);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Notifications/ }));
    });
    return screen.getByRole("dialog", { name: "Recent" });
  };

  it("is a dialog named 'Recent' that takes focus itself, not its first button", async () => {
    const dialog = await open();
    expect(document.activeElement).toBe(dialog);
  });

  it("puts the rows before 'Mark all as read', so Tab reaches a row first", async () => {
    const dialog = await open([row("a"), row("b")]);
    const tabbables = within(dialog)
      .getAllByRole("link")
      .concat(within(dialog).getAllByRole("button"));
    const ordered = tabbables
      .sort((x, y) =>
        x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING
          ? -1
          : 1,
      )
      .map((el) => el.textContent);
    expect(ordered).toEqual([
      "Row a",
      "Row b",
      "See all notifications",
      "Mark all as read",
    ]);
  });
});
