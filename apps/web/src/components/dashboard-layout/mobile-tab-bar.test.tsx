// @vitest-environment happy-dom
// The phone tab bar publishes its measured height so whatever docks above it (toasts, the install
// tip, the quick-start footer) follows the bar instead of a hard-coded 57px, and pads the home
// indicator only in the installed app. UX-06: the Community tab carries a dot for unread messages
// and the Swaps tab a badge for waiting requests; both counts are in the tab's name, the visual
// badges are aria-hidden.
import { act, cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { MobileTabBar } from "./mobile-tab-bar";
import { MOBILE_TAB_BAR_HEIGHT_VAR } from "./sticky-offset";

const mocks = vi.hoisted(() => ({
  pathname: "/dashboard",
  unreadMessages: 0,
  pendingRequests: 0,
}));

vi.mock("@/compat/navigation", () => ({
  usePathname: () => mocks.pathname,
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useRouter: () => ({ latestLocation: { href: mocks.pathname } }),
}));
vi.mock("./nav-counts", () => ({
  useUnreadMessageCount: () => mocks.unreadMessages,
  usePendingRequestCount: () => mocks.pendingRequests,
}));
vi.mock("@/components/whats-new/use-whats-new-state", () => ({
  useWhatsNewUnreadCount: () => 0,
}));
vi.mock("./mobile-quick-sheet", () => ({ MobileQuickSheet: () => null }));
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

const wrap = (node: ReactNode) => (
  <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
    {node}
  </IntlProvider>
);

const cssVar = () =>
  document.documentElement.style.getPropertyValue(MOBILE_TAB_BAR_HEIGHT_VAR);

describe("MobileTabBar", () => {
  beforeEach(() => {
    // The bar's row plus its border, as a phone lays it out.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      () => DOMRect.fromRect({ x: 0, y: 787, width: 390, height: 57 }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    mocks.pathname = "/dashboard";
    mocks.unreadMessages = 0;
    mocks.pendingRequests = 0;
    document.documentElement.style.removeProperty(MOBILE_TAB_BAR_HEIGHT_VAR);
  });

  it("publishes its height while it is on screen", () => {
    render(wrap(<MobileTabBar />));
    expect(screen.getByRole("navigation")).toBeTruthy();
    expect(cssVar()).toBe("57px");
  });

  it("clears the height on an open thread, where it steps aside", () => {
    const { rerender } = render(wrap(<MobileTabBar />));
    expect(cssVar()).toBe("57px");
    mocks.pathname = "/messages/abc";
    act(() => rerender(wrap(<MobileTabBar />)));
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(cssVar()).toBe("");
  });

  it("pads the home indicator only when running as the installed app", () => {
    render(wrap(<MobileTabBar />));
    const nav = screen.getByRole("navigation");
    expect(nav.className).toContain(
      "[@media(display-mode:standalone)]:pb-[env(safe-area-inset-bottom)]",
    );
    // A browser tab's own bottom chrome already clears the home indicator.
    expect(nav.className).not.toMatch(/(^|\s)pb-\[env\(safe-area/);
  });

  it("names the tabs plainly when nothing is waiting", () => {
    render(wrap(<MobileTabBar />));
    for (const name of ["Swaps", "Community"]) {
      const tab = screen.getByRole("link", { name });
      expect(tab.querySelector("[aria-hidden]:not(svg)")).toBeNull();
    }
  });

  it("puts the waiting requests in the Swaps tab's name, with an aria-hidden badge", () => {
    mocks.pendingRequests = 2;
    render(wrap(<MobileTabBar />));
    const swaps = screen.getByRole("link", {
      name: "Swaps, 2 requests waiting for your reply",
    });
    const badge = swaps.querySelector("[aria-hidden]:not(svg)");
    expect(badge?.textContent).toBe("2");
  });

  it("dots the Community tab for unread messages and names the count", () => {
    mocks.unreadMessages = 3;
    render(wrap(<MobileTabBar />));
    const community = screen.getByRole("link", {
      name: "Community, 3 unread messages",
    });
    const dot = community.querySelector("[aria-hidden]:not(svg)");
    expect(dot).toBeTruthy();
    expect(dot?.textContent).toBe("");
  });

  it("names the counts in Dutch", () => {
    mocks.pendingRequests = 1;
    mocks.unreadMessages = 1;
    render(
      <IntlProvider locale="nl" messages={nl} timeZone="Europe/Amsterdam">
        <MobileTabBar />
      </IntlProvider>,
    );
    expect(
      screen.getByRole("link", {
        name: "Ruilen, 1 verzoek wacht op je antwoord",
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Community, 1 ongelezen bericht" }),
    ).toBeTruthy();
  });
});
