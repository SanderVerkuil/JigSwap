// @vitest-environment happy-dom
// The "-" prefix keeps the TanStack route generator from treating this file as a route.
// UX-158: no surface states a keyboard shortcut the member's platform doesn't use. My Puzzles' own
// search box (UX-22) replaced its "Press ⌘K" hint, so it names none at all, on any platform.
// UX-157: the puzzle count shows once.
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../../locales/en.json";
import nl from "../../../../locales/nl.json";
import { Route } from "./index";

const mocks = vi.hoisted(() => ({
  header: undefined as { meta?: unknown; actions?: unknown } | undefined,
  // The library's size: 0 shows the empty state.
  total: 1,
}));

// The list state lives in the URL; a bare /my-puzzles has none of it.
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: object) => ({
    options,
    useSearch: () => ({}),
  }),
  useNavigate: () => vi.fn(),
}));
// The server reads the request's cookies; this member's request carries none.
vi.mock("@tanstack/react-start/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start/server")>()),
  getCookie: () => undefined,
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
            ? { rows: [], hasMore: false, matched: 0, total: mocks.total }
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
  mocks.total = 1;
  localStorage.clear();
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

// Below md the tab bar's raised + is the screen's one marigold control (DESIGN.md), so the page's
// own Add Puzzle turns canal there; from md it is the marigold `brand` the top bar leaves out here.
describe("My Puzzles Add Puzzle on a phone", () => {
  const PHONE_CANAL = [
    "max-md:bg-primary",
    "max-md:text-primary-foreground",
    "max-md:hover:bg-primary/90",
  ];

  it("turns the head's Add Puzzle canal below md", () => {
    stubPlatform("Win32");
    render(page());
    render(<>{mocks.header?.actions as ReactNode}</>);
    const add = screen.getByRole("link", { name: "Add Puzzle" });
    expect([...add.classList]).toEqual(
      expect.arrayContaining(["bg-jigsaw-gold", ...PHONE_CANAL]),
    );
  });

  it("turns the empty library's Add Puzzle canal below md", () => {
    mocks.total = 0;
    stubPlatform("Win32");
    render(page());
    const add = screen.getByRole("link", { name: "Add Puzzle" });
    expect(add.getAttribute("data-tour")).toBe("my-puzzles-add");
    expect([...add.classList]).toEqual(
      expect.arrayContaining(["bg-jigsaw-gold", ...PHONE_CANAL]),
    );
  });
});

// The hint's dismissal is a cookie the server reads, so the hint never appears after hydration
// and pushes the list down. The cookie is scoped to /my-puzzles, where the page lives.
describe("My Puzzles coachmark in the browser", () => {
  const body = en.puzzles.coachmark.body;

  beforeEach(() => {
    window.history.pushState({}, "", "/my-puzzles");
  });
  afterEach(() => {
    document.cookie =
      "puzzles_coachmark_dismissed=; path=/my-puzzles; max-age=0";
    window.history.pushState({}, "", "/");
  });

  it("is dismissed into a cookie on /my-puzzles, and stays dismissed", () => {
    stubPlatform("Win32");
    render(page());
    fireEvent.click(screen.getByRole("button", { name: "Dismiss hint" }));
    expect(screen.queryByText(body)).toBeNull();
    expect(document.cookie).toContain("puzzles_coachmark_dismissed=1");

    cleanup();
    localStorage.clear();
    render(page());
    expect(screen.queryByText(body)).toBeNull();

    // Scoped: no other page's requests carry it.
    window.history.pushState({}, "", "/dashboard");
    expect(document.cookie).not.toContain("puzzles_coachmark_dismissed");
  });

  it("honours a dismissal from before the cookie and copies it over", () => {
    localStorage.setItem("jigswap.coachmark.myPuzzlesActions", "1");
    stubPlatform("Win32");
    render(page());
    expect(screen.queryByText(body)).toBeNull();
    expect(document.cookie).toContain("puzzles_coachmark_dismissed=1");
  });

  // Every dismissal from before the cookie is in localStorage alone, which the server can't read,
  // so that member's first My Puzzles after it still has the hint in its HTML. The page's head
  // script hides it before the first paint, so hydration taking it out moves nothing.
  it("keeps a dismissal from before the cookie out of the first paint", async () => {
    localStorage.setItem("jigswap.coachmark.myPuzzlesActions", "1");
    stubPlatform("Win32");
    const html = renderToString(page());
    expect(html).toContain(body);

    // The head's scripts run before the browser parses the body.
    const { head } = (
      Route as unknown as {
        options: {
          head: (ctx: { match: { context: unknown } }) => {
            scripts?: { children: string }[];
          };
        };
      }
    ).options;
    for (const script of head({ match: { context: {} } }).scripts ?? []) {
      new Function(script.children)();
    }
    const container = document.createElement("div");
    document.body.append(container);
    container.innerHTML = html;
    expect(
      document.documentElement.hasAttribute("data-coachmark-dismissed"),
    ).toBe(true);
    expect(screen.getByText(body).parentElement?.classList).toContain(
      "in-data-coachmark-dismissed:hidden",
    );
    // The browser's hydration render reads document.cookie. Here, without the Start compiler,
    // createIsomorphicFn always runs its server side, so the hydration below can't see a cookie
    // written too early: check that the head left it alone.
    expect(document.cookie).not.toContain("puzzles_coachmark_dismissed");

    // Hydration agrees with the server, then drops the hidden hint and copies the dismissal over.
    const mismatches: unknown[] = [];
    const root = await act(async () =>
      hydrateRoot(container, page(), {
        onRecoverableError: (error) => mismatches.push(error),
      }),
    );
    expect(mismatches).toEqual([]);
    expect(container.textContent).not.toContain(body);
    expect(document.cookie).toContain("puzzles_coachmark_dismissed=1");

    await act(async () => root.unmount());
    container.remove();
    document.documentElement.removeAttribute("data-coachmark-dismissed");
  });
});
