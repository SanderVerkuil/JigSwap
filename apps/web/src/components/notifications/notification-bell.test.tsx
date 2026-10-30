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
  useUser: () => ({ user: { id: "clerk_me" } }),
}));

vi.mock("@/compat/link", () => ({
  Link: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
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

describe("NotificationBell badge", () => {
  it("shows and announces the exact count below the cap", () => {
    renderBell(7);
    const badge = screen.getByLabelText("7 unread notifications");
    expect(badge.textContent).toBe("7");
  });

  it("shows and announces 99+ at the backend cap of 100", () => {
    renderBell(100);
    const badge = screen.getByLabelText("99+ unread notifications");
    expect(badge.textContent).toBe("99+");
  });

  it("announces the capped count in Dutch", () => {
    renderBell(100, "nl");
    expect(screen.getByLabelText("99+ ongelezen meldingen").textContent).toBe(
      "99+",
    );
  });
});
