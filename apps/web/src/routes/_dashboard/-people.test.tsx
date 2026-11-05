// @vitest-environment happy-dom
// The "-" prefix keeps the TanStack route generator from treating this file as a route.
import {
  APP_SCROLL_REGION_ID,
  appScrollRestoration,
} from "@/lib/scroll-restoration";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { Route as PeopleRoute } from "./people";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// The child panels are out of scope; the page's data is the network page below.
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: [] }),
}));
vi.mock("@convex-dev/react-query", () => ({ convexQuery: () => ({}) }));
vi.mock("@/gateway", () => ({
  gateway: { social: {}, identity: {} },
}));
const network = vi.hoisted(() => ({
  results: [] as Array<{ memberId: string; followsYou: boolean }>,
  status: "Exhausted" as string,
  loadMore: vi.fn(),
}));
vi.mock("convex-helpers/react", () => ({ usePaginatedQuery: () => network }));
// The header actions the page publishes, kept so a test can render them.
const published = vi.hoisted(() => ({
  actions: undefined as ReactNode,
  meta: undefined as ReactNode,
}));
vi.mock("@/components/dashboard-layout/page-header-slot", () => ({
  usePageHeader: (factory: () => { actions?: ReactNode; meta?: ReactNode }) => {
    published.actions = factory().actions;
    published.meta = factory().meta;
  },
}));
vi.mock("@/components/tour/guide-help-button", () => ({
  GuideHelpButton: ({ tourId }: { tourId: string }) => (
    <button type="button" data-guide={tourId} />
  ),
}));
vi.mock("@/components/social/activity-feed", () => ({
  ActivityFeed: () => <p>activity panel</p>,
}));
vi.mock("@/components/social/find-people", () => ({
  FindPeople: () => <p>find panel</p>,
}));
vi.mock("@/components/social/connection-offers", () => ({
  ConnectionOffersStrip: () => null,
}));
vi.mock("@/components/social/follow-requests-strip", () => ({
  FollowRequestsStrip: () => null,
}));
vi.mock("@/components/social/member-tile", () => ({
  MemberTile: ({
    memberId,
    followsYou,
  }: {
    memberId: string;
    followsYou?: boolean;
  }) => (
    <p>
      tile {memberId} {followsYou ? "follows you" : ""}
    </p>
  ),
  MemberTileSkeleton: () => null,
}));
vi.mock("@/components/social/qr-dialog", () => ({ QrDialog: () => null }));
vi.mock("@/components/social/email-invite", () => ({
  EmailInvite: () => null,
}));
vi.mock("@/components/social/network-invite", () => ({
  NetworkInvite: () => <p>invite link panel</p>,
}));

// Mirrors the desktop dashboard shell: the page scrolls inside one region, not the window.
function makeRouter() {
  const rootRoute = createRootRoute({
    component: () => (
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <div data-scroll-restoration-id={APP_SCROLL_REGION_ID}>
          <Outlet />
        </div>
      </IntlProvider>
    ),
  });
  const dashboard = createRoute({
    getParentRoute: () => rootRoute,
    id: "_dashboard",
    component: Outlet,
  });
  // Attach the real file route the way routeTree.gen does, so its useSearch/useNavigate resolve.
  const people = PeopleRoute.update({
    id: "/people",
    path: "/people",
    getParentRoute: () => dashboard,
  } as never);
  return createRouter({
    routeTree: rootRoute.addChildren([dashboard.addChildren([people])]),
    history: createMemoryHistory({ initialEntries: ["/people"] }),
    ...appScrollRestoration,
  });
}

function region() {
  return document.querySelector<HTMLElement>(
    `[data-scroll-restoration-id="${APP_SCROLL_REGION_ID}"]`,
  )!;
}

function tab(name: string) {
  return Array.from(
    document.querySelectorAll<HTMLElement>('[role="tab"]'),
  ).find((el) => el.textContent?.includes(name))!;
}

describe("People tabs", () => {
  let container: HTMLDivElement;
  let root: Root;
  let router: ReturnType<typeof makeRouter>;

  beforeEach(async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    router = makeRouter();
    await act(async () => {
      root.render(<RouterProvider router={router} />);
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("switches tab without scrolling the content region to the top", async () => {
    region().scrollTop = 600;
    region().dispatchEvent(new Event("scroll"));

    // Radix tabs activate on a primary-button mousedown.
    await act(async () => {
      tab(en.people.tabs.find).dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0 }),
      );
    });
    await vi.waitFor(() =>
      expect(router.state.resolvedLocation?.search).toEqual({ tab: "find" }),
    );

    expect(document.body.textContent).toContain("find panel");
    // The invite link is there for a member without a username too, not only in the setup step.
    expect(document.body.textContent).toContain("invite link panel");
    expect(region().scrollTop).toBe(600);
  });
});

describe("People header", () => {
  it("publishes the member-profiles guide's ? button (UX-91)", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => {
      root.render(<RouterProvider router={makeRouter()} />);
    });
    expect(renderToStaticMarkup(<>{published.actions}</>)).toContain(
      'data-guide="member-profiles"',
    );
    act(() => root.unmount());
  });
});

describe("People header count", () => {
  // On Find people or Activity it would read as the number of members found.
  it("only says how big the network is on the network tab", async () => {
    network.results = [{ memberId: "m1", followsYou: false }];
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const router = makeRouter();
    await act(async () => {
      root.render(<RouterProvider router={router} />);
    });
    expect(published.meta).toBe("1 member in your network");

    await act(async () => {
      tab(en.people.tabs.find).dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0 }),
      );
    });
    await vi.waitFor(() => expect(published.meta).toBeUndefined());

    act(() => root.unmount());
    container.remove();
    network.results = [];
  });
});

describe("People network", () => {
  const renderPeople = async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<RouterProvider router={makeRouter()} />);
    });
    return () => {
      act(() => root.unmount());
      container.remove();
    };
  };

  afterEach(() => {
    network.results = [];
    network.status = "Exhausted";
    network.loadMore.mockClear();
  });

  it("shows the page with each member's own 'follows you', and the exact count once all loaded", async () => {
    network.results = [
      { memberId: "m1", followsYou: true },
      { memberId: "m2", followsYou: false },
    ];
    const done = await renderPeople();
    expect(document.body.textContent).toContain("tile m1 follows you");
    expect(document.body.textContent).toContain("tile m2");
    expect(document.body.textContent).not.toContain("tile m2 follows you");
    expect(published.meta).toBe("2 members in your network");
    expect(document.body.textContent).not.toContain("Show more");
    done();
  });

  it("says the count is partial while more pages remain, and Show more asks for them", async () => {
    network.results = [{ memberId: "m1", followsYou: false }];
    network.status = "CanLoadMore";
    const done = await renderPeople();
    expect(published.meta).toBe("1+ members in your network");
    const showMore = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "Show more",
    )!;
    await act(async () => {
      showMore.click();
    });
    expect(network.loadMore).toHaveBeenCalledWith(48);
    done();
  });
});
