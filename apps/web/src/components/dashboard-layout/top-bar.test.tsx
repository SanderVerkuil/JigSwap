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
import nl from "../../../locales/nl.json";
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

  // From lg to xl the label costs the search pill its place. It stays the link's name.
  it("shows only its icon from lg to xl and keeps its name", () => {
    render(topBar());
    const label = screen.getByText(en.shell.actions.addToMyPuzzles);
    expect(label.className).toContain("max-xl:sr-only");
    expect(addLink()?.className).toContain("lg:max-xl:w-9");
    expect(addLink()).not.toBeNull();
  });
});

// The pill sits in the middle column of a 1fr-auto-1fr grid: whether the add shortcut is there
// changes the right column's content, not where the middle column lands.
describe("TopBar layout", () => {
  it("centres the search pill in a grid, with the side columns equally wide", () => {
    render(topBar());
    const pill = searchPill();
    const bar = pill.closest("header");
    expect(bar?.className).toContain("grid-cols-[1fr_minmax(0,520px)_1fr]");
    expect(pill.parentElement).toBe(bar);
    expect(pill.className).toContain("w-full");
  });

  // The short label below lg can outgrow a 1fr column, and the pill would move between pages.
  it("keeps the pill's left edge below lg by hugging the logo", () => {
    render(topBar());
    expect(searchPill().closest("header")?.className).toContain(
      "max-lg:grid-cols-[auto_minmax(0,520px)_1fr]",
    );
  });

  // F66: on a touch tablet the controls are 44px, so a 48px bar left them no room and clipped the
  // bell's badge. The sidebar starts below the taller bar (app-sidebar.test.tsx).
  it("is 48px tall for a mouse and 56px on touch", () => {
    render(topBar());
    const classes = (searchPill().closest("header")?.className ?? "").split(
      /\s+/,
    );
    expect(classes).toContain("h-12");
    expect(classes).toContain("pointer-coarse:h-14");
  });
});

describe("TopBar add action", () => {
  it("keeps its full name for assistive tech and shows a short label below lg", () => {
    render(topBar());
    const add = screen.getByRole("link", {
      name: en.shell.actions.addToMyPuzzles,
    });
    expect(add.getAttribute("href")).toBe("/my-puzzles/add");
    const short = screen.getByText(en.shell.actions.add);
    const full = add.querySelector("span.lg\\:inline");
    expect(short.className).toContain("lg:hidden");
    expect(full?.textContent).toBe(en.shell.actions.addToMyPuzzles);
  });

  it("names the action in a way the short label is part of (WCAG 2.5.3)", () => {
    expect(en.shell.actions.addToMyPuzzles).toContain(en.shell.actions.add);
    expect(nl.shell.actions.addToMyPuzzles).toContain(nl.shell.actions.add);
  });
});
