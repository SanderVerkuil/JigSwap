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
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { Route as PeopleRoute } from "./people";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// The page's data and child panels are out of scope: only the tab switch and the scroll region matter.
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: [] }),
}));
vi.mock("@convex-dev/react-query", () => ({ convexQuery: () => ({}) }));
vi.mock("@/gateway", () => ({
  gateway: { social: {}, identity: {} },
}));
vi.mock("@/components/dashboard-layout/page-header-slot", () => ({
  usePageHeaderActions: () => {},
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
  MemberTile: () => null,
  MemberTileSkeleton: () => null,
}));
vi.mock("@/components/social/qr-dialog", () => ({ QrDialog: () => null }));
vi.mock("@/components/social/email-invite", () => ({
  EmailInvite: () => null,
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
    expect(region().scrollTop).toBe(600);
  });
});
