// @vitest-environment happy-dom
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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  APP_SCROLL_REGION_ID,
  appScrollRestoration,
} from "./scroll-restoration";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// Mirrors the desktop dashboard shell: the page scrolls inside one region, not the window.
function makeRouter() {
  const rootRoute = createRootRoute({
    component: () => (
      <div data-scroll-restoration-id={APP_SCROLL_REGION_ID}>
        <Outlet />
      </div>
    ),
  });
  const page = (path: string) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path,
      component: () => <p>{path}</p>,
    });
  return createRouter({
    routeTree: rootRoute.addChildren([page("/a"), page("/b")]),
    history: createMemoryHistory({ initialEntries: ["/a"] }),
    ...appScrollRestoration,
  });
}

function region() {
  return document.querySelector<HTMLElement>(
    `[data-scroll-restoration-id="${APP_SCROLL_REGION_ID}"]`,
  )!;
}

function scrollRegion(top: number) {
  region().scrollTop = top;
  region().dispatchEvent(new Event("scroll"));
}

describe("app scroll restoration", () => {
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

  // Drive the history directly: this test router's routes aren't the app's
  // registered route tree, so the typed `navigate` would reject "/b".
  async function go(move: () => void, pathname: string) {
    await act(async () => move());
    await vi.waitFor(() =>
      expect(router.state.resolvedLocation?.pathname).toBe(pathname),
    );
  }

  it("starts a new route at the top of the scroll region", async () => {
    scrollRegion(600);
    await go(() => router.history.push("/b"), "/b");
    expect(region().scrollTop).toBe(0);
  });

  // In-page view switches (tabs, filters) opt out of the reset per navigation.
  it("keeps the region's position on a search-only change with resetScroll: false", async () => {
    scrollRegion(600);
    await act(async () => {
      await router.navigate({
        to: "/a",
        search: { tab: "find" },
        resetScroll: false,
      } as never);
    });
    expect(router.state.resolvedLocation?.search).toEqual({ tab: "find" });
    expect(region().scrollTop).toBe(600);
  });

  it("still resets the region on a route change after a search-only change", async () => {
    scrollRegion(600);
    await act(async () => {
      await router.navigate({
        to: "/a",
        search: { tab: "find" },
        resetScroll: false,
      } as never);
    });
    await go(() => router.history.push("/b"), "/b");
    expect(region().scrollTop).toBe(0);
  });

  it("restores the region's position on back", async () => {
    scrollRegion(600);
    await go(() => router.history.push("/b"), "/b");
    await go(() => router.history.back(), "/a");
    expect(region().scrollTop).toBe(600);
  });
});
