// @vitest-environment happy-dom
// The shell page head (md+) and its phone counterpart (MobilePageActions) render what a page
// publishes through the page-header slot. Layout is asserted through the class contract that
// keeps it from breaking: rows that wrap instead of overflowing, a crumb row that is always
// there so the h1 sits at the same height on every page, and page meta in one fixed spot.
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { PageHead } from "./page-head";
import {
  PageHeaderSlotProvider,
  usePageHeader,
  usePageHeaderActions,
  type PageHeaderContent,
} from "./page-header-slot";
import { MobilePageActions } from "./shell";

const mocks = vi.hoisted(() => ({ pathname: "/notifications" }));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useLocation: (opts?: {
    select?: (location: { pathname: string }) => unknown;
  }) => {
    const location = { pathname: mocks.pathname };
    return opts?.select ? opts.select(location) : location;
  },
}));

vi.mock("@/compat/clerk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/compat/clerk")>()),
  useUser: () => ({ user: { firstName: "Henk" } }),
}));

// The router's Link needs a router context; a plain anchor is enough for the head's markup.
vi.mock("@/compat/link", () => ({
  Link: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children?: ReactNode;
    className?: string;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// The rest of the shell's chrome is out of scope (and pulls in build-time virtual modules).
vi.mock("./app-sidebar", () => ({ AppSidebar: () => null }));
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

afterEach(() => {
  cleanup();
  mocks.pathname = "/notifications";
});

function Publish({ content }: { content: PageHeaderContent }) {
  usePageHeader(() => content, [content]);
  return null;
}

function PublishActions({ actions }: { actions: ReactNode }) {
  usePageHeaderActions(() => actions, [actions]);
  return null;
}

function renderShellHead(pathname: string, page?: ReactNode) {
  mocks.pathname = pathname;
  return render(
    <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
      <PageHeaderSlotProvider>
        <PageHead />
        <MobilePageActions />
        {page}
      </PageHeaderSlotProvider>
    </IntlProvider>,
  );
}

function slot(container: HTMLElement, name: string) {
  return container.querySelector<HTMLElement>(`[data-slot="${name}"]`);
}

describe("PageHead crumb row", () => {
  it("reserves an empty, hidden crumb row on an ungrouped page so the h1 does not shift", () => {
    const { container } = renderShellHead("/notifications");
    const crumbs = slot(container, "page-head-crumbs");
    expect(crumbs).not.toBeNull();
    expect(crumbs?.className).toContain("min-h-4");
    expect(crumbs?.getAttribute("aria-hidden")).toBe("true");
    expect(crumbs?.querySelector("nav")).toBeNull();
  });

  it("reserves the crumb row on the dashboard too", () => {
    const { container } = renderShellHead("/dashboard");
    const crumbs = slot(container, "page-head-crumbs");
    expect(crumbs?.className).toContain("min-h-4");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain(
      "Henk",
    );
  });

  it("fills the same row with the breadcrumb on a grouped page", () => {
    const { container } = renderShellHead("/circles");
    const crumbs = slot(container, "page-head-crumbs");
    expect(crumbs?.className).toContain("min-h-4");
    expect(crumbs?.hasAttribute("aria-hidden")).toBe(false);
    const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(crumbs?.contains(nav)).toBe(true);
    expect(nav.textContent).toContain("Community");
  });
});

describe("PageHead title and actions", () => {
  it("lets the actions wrap below the title instead of squeezing it", () => {
    const { container } = renderShellHead(
      "/notifications",
      <PublishActions
        actions={
          <>
            <button type="button">Notification preferences</button>
            <button type="button">Mark all as read</button>
          </>
        }
      />,
    );
    const row = slot(container, "page-head-row");
    expect(row?.className).toMatch(/\bflex-wrap\b/);

    const title = slot(container, "page-head-title");
    expect(title?.className).not.toMatch(/\bmin-w-0\b/);
    expect(title?.className).toContain("min-w-[min(100%,16rem)]");

    const actions = slot(container, "page-head-actions");
    expect(actions?.className).toMatch(/\bflex-wrap\b/);
    expect(actions?.className).not.toMatch(/\bshrink-0\b/);
    expect(actions?.textContent).toContain("Mark all as read");
  });

  it("pins the title to the top of the row so taller actions cannot move the h1", () => {
    const { container } = renderShellHead(
      "/household",
      <PublishActions actions={<button type="button">Invite</button>} />,
    );
    const row = slot(container, "page-head-row");
    expect(row?.className).toMatch(/\bitems-start\b/);
    expect(row?.className).not.toMatch(/\bitems-center\b/);
    // At least one h1 line tall, so short content (a lone meta line) still centres on the title.
    const actions = slot(container, "page-head-actions");
    expect(actions?.className).toMatch(/\bmin-h-8\b/);
    expect(actions?.className).toMatch(/\bitems-center\b/);
  });

  it("never truncates the subtitle", () => {
    renderShellHead("/my-puzzles");
    const subtitle = screen.getByText(en.shell.pages.myPuzzles.subtitle);
    expect(subtitle.className).not.toMatch(/\btruncate\b/);
  });
});

describe("page meta", () => {
  it("renders published meta first in the head's action cluster, wide screens only", () => {
    const { container } = renderShellHead(
      "/notifications",
      <Publish
        content={{
          meta: "2 unread notifications",
          actions: <button type="button">Mark all as read</button>,
        }}
      />,
    );
    const actions = slot(container, "page-head-actions");
    const meta = slot(container, "page-head-meta");
    expect(meta?.textContent).toBe("2 unread notifications");
    expect(actions?.firstElementChild).toBe(meta);
    expect(meta?.className).toMatch(/(^|\s)hidden(\s|$)/);
    expect(meta?.className).toContain("xl:inline");
  });

  it("keeps meta out of the phone actions row", () => {
    const { container } = renderShellHead(
      "/notifications",
      <Publish
        content={{
          meta: "2 unread notifications",
          actions: <button type="button">Mark all as read</button>,
        }}
      />,
    );
    const mobile = slot(container, "mobile-page-actions");
    expect(mobile?.textContent).toContain("Mark all as read");
    expect(mobile?.textContent).not.toContain("2 unread notifications");
  });

  it("renders no phone actions row for a page that only publishes meta", () => {
    const { container } = renderShellHead(
      "/borrowed",
      <Publish content={{ meta: "1 borrowed puzzle" }} />,
    );
    expect(slot(container, "page-head-meta")?.textContent).toBe(
      "1 borrowed puzzle",
    );
    expect(slot(container, "mobile-page-actions")).toBeNull();
  });
});

describe("MobilePageActions", () => {
  it("wraps its row instead of pushing actions off the left edge", () => {
    const { container } = renderShellHead(
      "/my-puzzles/add",
      <PublishActions
        actions={
          <>
            <button type="button">Laat me zien hoe</button>
            <button type="button">Meerdere toevoegen</button>
            <button type="button">Nieuwe aanmaken</button>
          </>
        }
      />,
    );
    const mobile = slot(container, "mobile-page-actions");
    expect(mobile?.className).toMatch(/\bflex-wrap\b/);
    expect(mobile?.className).toContain("justify-end");
  });
});
