// @vitest-environment happy-dom
import { gateway } from "@/gateway";
import { convexQuery, ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
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

// The badge is read-only here; the bell's mutations are never fired.
vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation: () => () => Promise.resolve(null),
}));

afterEach(cleanup);

// Render the closed bell with the unread count seeded in the query cache; nothing reaches a server.
const renderBell = (unread: number, locale: "en" | "nl" = "en") => {
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

afterEach(cleanup);

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
