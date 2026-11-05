// @vitest-environment happy-dom
// UX-05: from 1024px the desktop sidebar remembers the member's toggle (sidebar_state cookie, read
// during SSR and passed in by the route). Below 1024px it always rests as the icon rail so a tablet
// keeps a usable content card; the toggle opens the labelled sidebar over the page instead, and
// that is neither docked nor remembered.
import { useSidebar } from "@/components/ui/sidebar";
import {
  SIDEBAR_COOKIE_NAME,
  SIDEBAR_WIDE_COOKIE_NAME,
  SIDEBAR_WIDE_QUERY,
  type SidebarCookies,
} from "@/lib/sidebar-state";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { DashboardShell } from "./shell";

const route = vi.hoisted(() => ({ pathname: "/dashboard" }));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useLocation: (opts?: {
    select?: (location: { pathname: string }) => unknown;
  }) => {
    const location = { pathname: route.pathname };
    return opts?.select ? opts.select(location) : location;
  },
}));

vi.mock("@/compat/clerk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/compat/clerk")>()),
  useUser: () => ({ user: { firstName: "Henk" } }),
}));

vi.mock("@/compat/link", () => ({
  Link: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

// Stand-in for the real sidebar: shows the provider's state and offers the toggle.
function SidebarProbe() {
  const { state, openMobile, toggleSidebar } = useSidebar();
  return (
    <button
      type="button"
      data-testid="sidebar"
      data-overlay={openMobile}
      onClick={toggleSidebar}
    >
      {state}
    </button>
  );
}
vi.mock("./app-sidebar", () => ({ AppSidebar: () => <SidebarProbe /> }));
vi.mock("./command-palette", () => ({ CommandPalette: () => null }));
vi.mock("./mobile-tab-bar", () => ({ MobileTabBar: () => null }));
vi.mock("./mobile-top-bar", () => ({ MobileTopBar: () => null }));
vi.mock("./top-bar", () => ({ TopBar: () => null }));
vi.mock("./sync-preferred-language", () => ({
  SyncPreferredLanguage: () => null,
}));
vi.mock("@/components/install-app/install-app-tip", () => ({
  InstallAppTip: () => null,
}));
vi.mock("@/components/whats-new/announcer", () => ({
  WhatsNewAnnouncer: () => null,
}));

// A window whose width can cross 1024px mid-test.
const media = { wide: true, listeners: new Set<() => void>() };
function setWide(wide: boolean) {
  media.wide = wide;
  act(() => media.listeners.forEach((listener) => listener()));
}

beforeEach(() => {
  route.pathname = "/dashboard";
  media.wide = true;
  media.listeners.clear();
  vi.stubGlobal("matchMedia", (query: string) => ({
    get matches() {
      return query === SIDEBAR_WIDE_QUERY ? media.wide : false;
    },
    media: query,
    addEventListener: (_: string, listener: () => void) =>
      media.listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) =>
      media.listeners.delete(listener),
  }));
  for (const name of [SIDEBAR_COOKIE_NAME, SIDEBAR_WIDE_COOKIE_NAME]) {
    document.cookie = `${name}=; path=/; max-age=0`;
  }
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const shell = (sidebar?: SidebarCookies) => (
  <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
    <DashboardShell sidebar={sidebar}>
      <p>page</p>
    </DashboardShell>
  </IntlProvider>
);

function renderShell(sidebar?: SidebarCookies) {
  render(shell(sidebar));
  return screen.getByTestId("sidebar");
}

const NO_COOKIES: SidebarCookies = { open: undefined, wide: undefined };

describe("DashboardShell sidebar state", () => {
  it("shows the icon rail on a tablet-width window when the member never chose", () => {
    media.wide = false;
    expect(renderShell(NO_COOKIES).textContent).toBe("collapsed");
  });

  it("docks the sidebar open on a wide window when the member never chose", () => {
    expect(renderShell(NO_COOKIES).textContent).toBe("expanded");
  });

  it("keeps a remembered choice on a wide window", () => {
    expect(renderShell({ open: false, wide: true }).textContent).toBe(
      "collapsed",
    );
    cleanup();
    expect(renderShell({ open: true, wide: true }).textContent).toBe(
      "expanded",
    );
  });

  it("rests as the icon rail on a tablet-width window, even when open was remembered", () => {
    media.wide = false;
    expect(renderShell({ open: true, wide: false }).textContent).toBe(
      "collapsed",
    );
  });

  it("follows the window across 1024px until the member toggles, then sticks", () => {
    const sidebar = renderShell(NO_COOKIES);
    setWide(false);
    expect(sidebar.textContent).toBe("collapsed");
    setWide(true);
    expect(sidebar.textContent).toBe("expanded");

    fireEvent.click(sidebar);
    expect(sidebar.textContent).toBe("collapsed");
    expect(document.cookie).toContain(`${SIDEBAR_COOKIE_NAME}=false`);

    setWide(false);
    setWide(true);
    expect(sidebar.textContent).toBe("collapsed");
  });

  describe("below 1024px, the toggle", () => {
    it("opens the overlay and leaves the rail and the remembered choice alone", () => {
      media.wide = false;
      const sidebar = renderShell(NO_COOKIES);

      fireEvent.click(sidebar);
      expect(sidebar.dataset.overlay).toBe("true");
      expect(sidebar.textContent).toBe("collapsed");
      expect(document.cookie).not.toContain(SIDEBAR_COOKIE_NAME);

      fireEvent.click(sidebar);
      expect(sidebar.dataset.overlay).toBe("false");
    });

    it("gets the overlay closed by navigating, however that happens", () => {
      media.wide = false;
      const view = render(shell(NO_COOKIES));
      const sidebar = screen.getByTestId("sidebar");
      fireEvent.click(sidebar);
      expect(sidebar.dataset.overlay).toBe("true");

      route.pathname = "/library";
      view.rerender(shell(NO_COOKIES));
      expect(sidebar.dataset.overlay).toBe("false");
    });

    it("gets the overlay closed when the window grows past 1024px, for good", () => {
      media.wide = false;
      const sidebar = renderShell(NO_COOKIES);
      fireEvent.click(sidebar);

      setWide(true);
      expect(sidebar.dataset.overlay).toBe("false");
      setWide(false);
      expect(sidebar.dataset.overlay).toBe("false");
    });
  });

  it("remembers which side of 1024px the window is on for the next server render", () => {
    media.wide = false;
    renderShell(NO_COOKIES);
    expect(document.cookie).toContain(`${SIDEBAR_WIDE_COOKIE_NAME}=false`);
    setWide(true);
    expect(document.cookie).toContain(`${SIDEBAR_WIDE_COOKIE_NAME}=true`);
  });
});
