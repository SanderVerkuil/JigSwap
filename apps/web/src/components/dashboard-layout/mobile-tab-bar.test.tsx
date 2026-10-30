// @vitest-environment happy-dom
// The phone tab bar publishes its measured height so whatever docks above it (toasts, the install
// tip, the quick-start footer) follows the bar instead of a hard-coded 57px, and pads the home
// indicator only in the installed app.
import { act, cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { MobileTabBar } from "./mobile-tab-bar";
import { MOBILE_TAB_BAR_HEIGHT_VAR } from "./sticky-offset";

const mocks = vi.hoisted(() => ({ pathname: "/dashboard" }));

vi.mock("@/compat/navigation", () => ({
  usePathname: () => mocks.pathname,
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useRouter: () => ({ latestLocation: { href: mocks.pathname } }),
}));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: () => ({ data: undefined }),
}));
vi.mock("@/components/dashboard-home/use-current-member", () => ({
  useCurrentMember: () => ({ member: null }),
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
});
