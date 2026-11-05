// @vitest-environment happy-dom
// UX-05: the desktop sidebar remembers the member's toggle (sidebar_state cookie, read during SSR
// and passed in by the route) and, with no choice yet, shows the icon rail below 1024px so a
// tablet keeps a usable content card.
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

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useLocation: (opts?: {
    select?: (location: { pathname: string }) => unknown;
  }) => {
    const location = { pathname: "/dashboard" };
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
  const { state, toggleSidebar } = useSidebar();
  return (
    <button type="button" data-testid="sidebar" onClick={toggleSidebar}>
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

function renderShell(sidebar?: SidebarCookies) {
  render(
    <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
      <DashboardShell sidebar={sidebar}>
        <p>page</p>
      </DashboardShell>
    </IntlProvider>,
  );
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

  it("keeps a remembered choice whatever the window width", () => {
    media.wide = false;
    expect(renderShell({ open: true, wide: false }).textContent).toBe(
      "expanded",
    );
    cleanup();
    media.wide = true;
    expect(renderShell({ open: false, wide: true }).textContent).toBe(
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

  it("remembers which side of 1024px the window is on for the next server render", () => {
    media.wide = false;
    renderShell(NO_COOKIES);
    expect(document.cookie).toContain(`${SIDEBAR_WIDE_COOKIE_NAME}=false`);
    setWide(true);
    expect(document.cookie).toContain(`${SIDEBAR_WIDE_COOKIE_NAME}=true`);
  });
});
