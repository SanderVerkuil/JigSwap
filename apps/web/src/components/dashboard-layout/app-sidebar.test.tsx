// @vitest-environment happy-dom
// UX-159: the sidebar's group labels link to their hub pages (/library, /community), the same
// destinations as the phone tabs, so they read as rows you can click: 12px, a row hover/focus
// background and a chevron on hover and focus, marked as the current page on the hub itself.
// UX-05: tablets default to the icon rail, where the Messages count pill is hidden, so the rail
// keeps a dot on the icon; the count itself stays in the link's accessible name.
// UX-146: the admin items carry the work waiting in their queues, with the same rail dot.
import { SidebarProvider } from "@/components/ui/sidebar";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { AppSidebar } from "./app-sidebar";

const mocks = vi.hoisted(() => ({
  pathname: "/dashboard",
  member: null as { _id: string } | null,
  unreadTotal: undefined as number | undefined,
  user: null as { id: string } | null,
  isAdmin: false,
  pendingCounts: undefined as unknown,
}));

vi.mock("@/compat/navigation", () => ({
  usePathname: () => mocks.pathname,
}));
vi.mock("@/compat/clerk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/compat/clerk")>()),
  useUser: () => ({ user: mocks.user }),
}));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  // isAdmin and every other nav item skip until a test sets them up.
  useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) => {
    if (queryKey.includes("skip")) return { data: undefined };
    const name = String(queryKey[1]);
    if (name.includes("isCurrentUserAdmin")) return { data: mocks.isAdmin };
    if (name.includes("getPendingCounts")) return { data: mocks.pendingCounts };
    return { data: mocks.unreadTotal };
  },
}));
vi.mock("@/components/dashboard-home/use-current-member", () => ({
  useCurrentMember: () => ({ member: mocks.member }),
}));
vi.mock("@/components/whats-new/use-whats-new-state", () => ({
  useWhatsNewUnreadCount: () => 0,
}));
vi.mock("./user-footer", () => ({ UserFooter: () => null }));
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

afterEach(() => {
  cleanup();
  mocks.pathname = "/dashboard";
  mocks.member = null;
  mocks.unreadTotal = undefined;
  mocks.user = null;
  mocks.isAdmin = false;
  mocks.pendingCounts = undefined;
});

function renderSidebar(pathname = "/dashboard") {
  mocks.pathname = pathname;
  return render(
    <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
      <SidebarProvider>
        <AppSidebar />
      </SidebarProvider>
    </IntlProvider>,
  );
}

function hubLink(name: string) {
  return screen.getByRole("link", { name });
}

function classesOf(element: Element) {
  return (element.getAttribute("class") ?? "").split(/\s+/);
}

describe("AppSidebar hub labels", () => {
  it("links each group label to its hub page", () => {
    renderSidebar();
    expect(hubLink(en.shell.groups.library.label).getAttribute("href")).toBe(
      "/library",
    );
    expect(hubLink(en.shell.groups.community.label).getAttribute("href")).toBe(
      "/community",
    );
  });

  it("renders the label as a serif row with a hover and focus background", () => {
    renderSidebar();
    const classes = classesOf(hubLink(en.shell.groups.library.label));
    expect(classes).toContain("text-[15px]");
    expect(classes).not.toContain("text-[10px]");
    expect(classes).toContain("hover:bg-sidebar-accent");
    expect(classes).toContain("focus-visible:bg-sidebar-accent");
  });

  it("reveals a decorative chevron on hover and keyboard focus", () => {
    renderSidebar();
    const chevron = hubLink(en.shell.groups.community.label).querySelector(
      "svg",
    );
    expect(chevron).not.toBeNull();
    expect(chevron?.getAttribute("aria-hidden")).toBe("true");
    const classes = classesOf(chevron as Element);
    expect(classes).toContain("opacity-0");
    expect(classes).toContain("group-hover/hub:opacity-100");
    expect(classes).toContain("group-focus-visible/hub:opacity-100");
  });

  it("marks the hub label as the current page on the hub itself", () => {
    renderSidebar("/library");
    expect(
      hubLink(en.shell.groups.library.label).getAttribute("aria-current"),
    ).toBe("page");
    expect(
      hubLink(en.shell.groups.community.label).hasAttribute("aria-current"),
    ).toBe(false);
    // The active look keys off aria-current, so it cannot drift from the semantics. It is an
    // underline, not a tinted pill (F67, DESIGN.md Navigation › Sidebar).
    const classes = classesOf(hubLink(en.shell.groups.library.label));
    expect(classes).toContain("aria-[current=page]:underline");
    expect(classes).not.toContain("aria-[current=page]:bg-sidebar-accent");
    // Hover and keyboard focus keep their row background.
    expect(classes).toContain("hover:bg-sidebar-accent");
    expect(classes).toContain("focus-visible:bg-sidebar-accent");
  });
});

describe("AppSidebar frame", () => {
  const container = () =>
    document.querySelector("[data-slot=sidebar-container]") as Element;

  // F66: the top bar is 56px on touch screens, so the sidebar starts below it there.
  it("slots below the top bar, 48px tall for a mouse and 56px on touch", () => {
    renderSidebar();
    const classes = classesOf(container());
    expect(classes).toContain("top-12");
    expect(classes).toContain("pointer-coarse:top-14");
  });

  // F57: while the cookie banner is open, the sidebar ends above it, so the account row (and with
  // it the only Sign out) isn't covered.
  it("ends above the cookie banner while it is open", () => {
    renderSidebar();
    const classes = classesOf(container());
    expect(classes).toContain(
      "h-[calc(100svh-3rem-var(--consent-banner-height,0px))]",
    );
    expect(classes).toContain(
      "pointer-coarse:h-[calc(100svh-3.5rem-var(--consent-banner-height,0px))]",
    );
  });
});

describe("AppSidebar Messages count", () => {
  const messagesItem = () =>
    screen
      .getByRole("link", { name: /^Messages/ })
      .closest("[data-sidebar=menu-item]") as HTMLElement;
  const railDot = () =>
    Array.from(messagesItem().querySelectorAll("[aria-hidden=true]")).find(
      (element) =>
        classesOf(element).includes("group-data-[collapsible=icon]:block"),
    );

  it("shows a decorative dot on the rail icon while messages are unread", () => {
    mocks.member = { _id: "m1" };
    mocks.unreadTotal = 3;
    renderSidebar();
    const dot = railDot();
    expect(dot).toBeDefined();
    // Hidden in the expanded sidebar, where the count pill shows instead.
    expect(classesOf(dot as Element)).toContain("hidden");
    expect(
      screen.getByRole("link", { name: /^Messages/ }).textContent,
    ).toContain("3");
  });

  it("shows no dot with nothing unread", () => {
    mocks.member = { _id: "m1" };
    mocks.unreadTotal = 0;
    renderSidebar();
    expect(railDot()).toBeUndefined();
  });
});

describe("AppSidebar admin queue counts", () => {
  const none = { count: 0, capped: false };
  const contactItem = () =>
    screen
      .getByRole("link", { name: /^Contact/ })
      .closest("[data-sidebar=menu-item]") as HTMLElement;
  const railDot = () =>
    Array.from(contactItem().querySelectorAll("[aria-hidden=true]")).find(
      (element) =>
        classesOf(element).includes("group-data-[collapsible=icon]:block"),
    );

  it("keeps the waiting work visible on the rail, in the primary colour, and in the link's name", () => {
    mocks.user = { id: "u1" };
    mocks.isAdmin = true;
    mocks.pendingCounts = {
      submissions: none,
      flagged: none,
      appeals: none,
      reports: none,
      hashMatches: none,
      proposals: none,
      contact: { count: 3, capped: false },
    };
    renderSidebar();

    const dot = railDot();
    expect(dot).toBeDefined();
    expect(classesOf(dot as Element)).toContain("hidden");
    expect(classesOf(dot as Element)).toContain("bg-primary");
    expect(classesOf(dot as Element)).not.toContain("bg-jigsaw-primary-accent");
    expect(
      screen.getByRole("link", { name: /^Contact/ }).textContent,
    ).toContain("3 waiting");
  });

  it("shows no dot on an empty queue", () => {
    mocks.user = { id: "u1" };
    mocks.isAdmin = true;
    mocks.pendingCounts = {
      submissions: none,
      flagged: none,
      appeals: none,
      reports: none,
      hashMatches: none,
      proposals: none,
      contact: none,
    };
    renderSidebar();
    expect(railDot()).toBeUndefined();
  });
});
