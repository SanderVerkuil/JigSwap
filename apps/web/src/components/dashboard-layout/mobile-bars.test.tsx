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
import { MobileTabBar } from "./mobile-tab-bar";
import { MobileTopBar } from "./mobile-top-bar";

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

vi.mock("@/compat/navigation", () => ({ usePathname: () => "/dashboard" }));

vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({
    latestLocation: { href: "/dashboard" },
    history: { canGoBack: () => false, subscribe: () => () => {} },
  }),
}));

vi.mock("@/components/dashboard-home/use-current-member", () => ({
  useCurrentMember: () => ({ member: { _id: "me" }, isMemberLoading: false }),
}));

vi.mock("@/components/whats-new/use-whats-new-state", () => ({
  useWhatsNewUnreadCount: () => 0,
}));

vi.mock("./shell-user-button", () => ({ ShellUserButton: () => null }));
vi.mock("./mobile-quick-sheet", () => ({ MobileQuickSheet: () => null }));

// Incoming swap requests awaiting an answer, the Swaps tab's pending count.
const proposedToMe = (id: string) => ({
  _id: id,
  userRole: "owner",
  status: "proposed",
});

const renderBars = ({
  unread = 0,
  pending = 0,
  locale = "en",
}: {
  unread?: number;
  pending?: number;
  locale?: "en" | "nl";
}) => {
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
  queryClient.setQueryData(
    convexQuery(gateway.exchange.forUser, {}).queryKey,
    Array.from({ length: pending }, (_, i) => proposedToMe(`x${i}`)),
  );
  render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider
        locale={locale}
        messages={locale === "en" ? en : nl}
        timeZone="Europe/Amsterdam"
      >
        <MobileTopBar onOpenPalette={() => {}} />
        <MobileTabBar />
      </IntlProvider>
    </QueryClientProvider>,
  );
};

afterEach(cleanup);

describe("mobile top bar bell", () => {
  it("is just 'Notifications' with nothing unread", () => {
    renderBars({});
    expect(screen.getByRole("link", { name: "Notifications" })).toBeTruthy();
  });

  it.each([
    [3, "en", "Notifications, 3 unread"],
    [120, "en", "Notifications, 99+ unread"],
    [3, "nl", "Meldingen, 3 ongelezen"],
  ] as const)("announces %s unread (%s)", (unread, locale, name) => {
    renderBars({ unread, locale });
    const link = screen.getByRole("link", { name });
    // The dot is decoration only; the count lives in the name.
    const dot = link.querySelector("span");
    expect(dot?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("mobile Swaps tab", () => {
  it("is just 'Swaps' with nothing to answer", () => {
    renderBars({});
    expect(screen.getByRole("link", { name: "Swaps" })).toBeTruthy();
  });

  it.each([
    [2, "en", "Swaps, 2 requests waiting for your reply", "2"],
    [12, "en", "Swaps, 9+, 12 requests waiting for your reply", "9+"],
    [2, "nl", "Ruilen, 2 verzoeken wachten op je antwoord", "2"],
  ] as const)(
    "carries the visible pending count %s (%s)",
    (pending, locale, name, visible) => {
      renderBars({ pending, locale });
      const tab = screen.getByRole("link", { name });
      const badge = Array.from(tab.querySelectorAll("[aria-hidden]")).find(
        (el) => el.textContent === visible,
      );
      expect(badge).toBeTruthy();
    },
  );
});
