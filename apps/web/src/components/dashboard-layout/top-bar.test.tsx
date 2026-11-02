// @vitest-environment happy-dom
// UX-158: the search pill names the palette shortcut for the platform it runs on, only after
// mount (the server cannot know it), announces both shortcuts to assistive tech and drops the
// key hint on touch screens.
import { SidebarProvider } from "@/components/ui/sidebar";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { TopBar } from "./top-bar";

const mocks = vi.hoisted(() => ({ pathname: "/dashboard" }));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useLocation: (opts?: {
    select?: (location: { pathname: string }) => unknown;
  }) => {
    const location = { pathname: mocks.pathname };
    return opts?.select ? opts.select(location) : location;
  },
}));
vi.mock("@/compat/link", () => ({
  Link: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/components/common/header-logo", () => ({ HeaderLogo: () => null }));
vi.mock("@/components/notifications/notification-bell", () => ({
  NotificationBell: () => null,
}));
vi.mock("@/components/ui/theme-toggle", () => ({ ModeToggle: () => null }));
vi.mock("@/components/ui/language-switcher", () => ({
  LanguageSwitcher: () => null,
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  mocks.pathname = "/dashboard";
});

function topBar() {
  return (
    <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
      <SidebarProvider>
        <TopBar onOpenPalette={() => {}} />
      </SidebarProvider>
    </IntlProvider>
  );
}

function stubPlatform(platform: string) {
  vi.stubGlobal("navigator", {
    ...navigator,
    platform,
    userAgentData: undefined,
  });
}

function searchPill() {
  return screen.getByRole("button", { name: /Search puzzles/ });
}

describe("TopBar search shortcut hint", () => {
  it("shows ⌘K on a Mac", () => {
    stubPlatform("MacIntel");
    render(topBar());
    expect(searchPill().querySelector("kbd")?.textContent).toBe("⌘K");
  });

  it("shows Ctrl K on Linux and Windows", () => {
    stubPlatform("Linux x86_64");
    render(topBar());
    expect(searchPill().querySelector("kbd")?.textContent).toBe("Ctrl K");
    cleanup();
    stubPlatform("Win32");
    render(topBar());
    expect(searchPill().querySelector("kbd")?.textContent).toBe("Ctrl K");
  });

  it("renders no hint on the server, where the platform is unknown", () => {
    const html = renderToString(topBar());
    expect(html).not.toContain("<kbd");
    expect(html).not.toContain("⌘K");
  });

  // Muted text on the muted chip is only 4.34:1.
  it("draws the hint in a colour that meets 4.5:1 on its chip", () => {
    stubPlatform("Win32");
    render(topBar());
    const classes = searchPill().querySelector("kbd")?.className;
    expect(classes).toContain("text-foreground/75");
    expect(classes).not.toContain("text-muted-foreground");
  });

  it("announces both shortcuts and hides the hint on touch screens", () => {
    stubPlatform("MacIntel");
    render(topBar());
    expect(searchPill().getAttribute("aria-keyshortcuts")).toBe(
      "Meta+K Control+K",
    );
    expect(searchPill().querySelector("kbd")?.className).toContain(
      "pointer-coarse:hidden",
    );
  });
});

// UX-24: the shortcut says where the puzzle ends up, and steps aside where the page offers its own
// add actions.
describe("TopBar add shortcut", () => {
  const addLink = () =>
    screen.queryByRole("link", { name: en.shell.actions.addToMyPuzzles });

  it("leads to adding a puzzle to the member's own puzzles", () => {
    render(topBar());
    expect(addLink()?.getAttribute("href")).toBe("/my-puzzles/add");
  });

  it("is left out on a page with its own add actions", () => {
    mocks.pathname = "/puzzles";
    render(topBar());
    expect(addLink()).toBeNull();
  });
});
