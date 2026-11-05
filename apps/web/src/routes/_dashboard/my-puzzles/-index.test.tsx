// @vitest-environment happy-dom
// The "-" prefix keeps the TanStack route generator from treating this file as a route.
// UX-158: no surface states a keyboard shortcut the member's platform doesn't use. My Puzzles' own
// search box (UX-22) replaced its "Press ⌘K" hint, so it names none at all, on any platform.
// UX-157: the puzzle count shows once.
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../../locales/en.json";
import nl from "../../../../locales/nl.json";
import { Route } from "./index";

const mocks = vi.hoisted(() => ({
  header: undefined as { meta?: unknown; actions?: unknown } | undefined,
}));

// The list state lives in the URL; a bare /my-puzzles has none of it.
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: object) => ({
    options,
    useSearch: () => ({}),
  }),
  useNavigate: () => vi.fn(),
}));
vi.mock("@/components/dashboard-layout/page-header-slot", () => ({
  usePageHeader: (factory: () => { meta?: unknown; actions?: unknown }) => {
    mocks.header = factory();
  },
  usePageHeaderContent: () => ({}),
}));
vi.mock("@/compat/clerk", () => ({
  useAuth: () => ({ isSignedIn: true }),
}));
vi.mock("@/compat/link", () => ({
  Link: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/gateway", () => ({
  gateway: {
    identity: { currentUser: "currentUser" },
    library: {
      myLibraryWindow: "myLibraryWindow",
      myLibraryIndex: "myLibraryIndex",
      myLibraryCopies: "myLibraryCopies",
      updateOffers: "updateOffers",
    },
    collections: { addOwnedPuzzle: "addOwnedPuzzle" },
    sharing: {
      myCircles: "myCircles",
      shareCopiesToCircle: "shareCopiesToCircle",
    },
    household: { copies: "householdCopies", mine: "householdMine" },
    lending: { lentOut: "lentOut", recallLoan: "recallLoan" },
  },
}));
vi.mock("@convex-dev/react-query", () => ({
  convexQuery: (name: string) => ({ name }),
  useConvexMutation: () => vi.fn(),
}));
// A signed-in member with a library and no household.
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ name }: { name: string }) => ({
    data:
      name === "currentUser"
        ? { _id: "member_1" }
        : name === "householdMine"
          ? null
          : name === "myLibraryWindow"
            ? { rows: [], hasMore: false, matched: 0, total: 1 }
            : [],
    isPending: false,
    isPlaceholderData: false,
  }),
  useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  keepPreviousData: undefined,
}));
vi.mock("@/components/library/copy-card-actions", () => ({
  useCopyCardActions: () => ({ cardActions: () => [], dialogs: null }),
  useSolveStateByCopyId: () => new Map(),
}));
vi.mock("@/lib/member-display-name", () => ({
  useMemberDisplayName: () => () => "",
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const page = (locale: "en" | "nl" = "en") => {
  const PuzzlesPage = Route.options.component as ComponentType;
  return (
    <IntlProvider
      locale={locale}
      messages={locale === "nl" ? nl : en}
      timeZone="Europe/Amsterdam"
    >
      <PuzzlesPage />
    </IntlProvider>
  );
};

function stubPlatform(platform: string) {
  vi.stubGlobal("navigator", {
    ...navigator,
    platform,
    userAgentData: undefined,
  });
}

describe("My Puzzles search", () => {
  it.each(["MacIntel", "Linux x86_64", "Win32"])(
    "offers its own search box and names no shortcut on %s",
    (platform) => {
      stubPlatform(platform);
      render(page());
      expect(
        screen.getByRole("searchbox", { name: en.puzzles.librarySearch.label }),
      ).toBeTruthy();
      expect(document.body.textContent).not.toMatch(/⌘K|Ctrl K/);
    },
  );

  it("speaks Dutch", () => {
    stubPlatform("Win32");
    render(page("nl"));
    expect(
      screen.getByRole("searchbox", { name: nl.puzzles.librarySearch.label }),
    ).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/⌘K|Ctrl K/);
  });

  it("names no shortcut on the server either", () => {
    const html = renderToString(page());
    expect(html).toContain("0 of 1 puzzles");
    expect(html).not.toMatch(/⌘K|Ctrl K/);
  });
});

describe("My Puzzles head", () => {
  it("leaves the count to the filter row and keeps its actions in the head", () => {
    stubPlatform("Win32");
    render(page());
    expect(screen.getByText("0 of 1 puzzles")).toBeTruthy();
    expect(mocks.header?.meta).toBeUndefined();
    expect(mocks.header?.actions).toBeTruthy();
  });
});
