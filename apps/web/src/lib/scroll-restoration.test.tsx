// @vitest-environment happy-dom
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  RouterProvider,
  useRouter,
} from "@tanstack/react-router";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  APP_SCROLL_REGION_ID,
  appScrollRestoration,
  scrollToTopIfCurrent,
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

// Mirrors the phone shell: the region doesn't scroll, the document does, and a
// bottom tab bar links to pages, including the one you're on.
function makePhoneRouter() {
  function TabBar() {
    const router = useRouter();
    return (
      <nav>
        {["/a", "/b"].map((href) => (
          <Link
            key={href}
            to={href as never}
            onClick={(event) =>
              scrollToTopIfCurrent(event, router.latestLocation.href, href)
            }
          >
            {href}
          </Link>
        ))}
        <Link to={"/a" as never}>plain /a</Link>
      </nav>
    );
  }
  const rootRoute = createRootRoute({
    component: () => (
      <>
        <div data-scroll-restoration-id={APP_SCROLL_REGION_ID}>
          <Outlet />
        </div>
        <TabBar />
      </>
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

function scrollDocument(top: number) {
  window.scrollTo({ top });
  document.dispatchEvent(new Event("scroll"));
}

describe("app scroll restoration on phones (the document scrolls)", () => {
  let container: HTMLDivElement;
  let root: Root;
  let router: ReturnType<typeof makePhoneRouter>;

  beforeEach(async () => {
    window.scrollTo({ top: 0 });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    router = makePhoneRouter();
    await act(async () => {
      root.render(<RouterProvider router={router} />);
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  function tab(text: string) {
    return [...container.querySelectorAll("a")].find(
      (a) => a.textContent === text,
    )!;
  }

  async function tap(text: string) {
    await act(async () => tab(text).click());
    await vi.waitFor(() => {
      expect(router.state.status).toBe("idle");
      expect(router.state.resolvedLocation?.href).toBe(
        router.latestLocation.href,
      );
    });
  }

  it("opens another tab's page at the top", async () => {
    scrollDocument(600);
    await tap("/b");
    expect(router.state.resolvedLocation?.pathname).toBe("/b");
    expect(window.scrollY).toBe(0);
  });

  it("restores the page position on back", async () => {
    scrollDocument(600);
    await tap("/b");
    await act(async () => router.history.back());
    await vi.waitFor(() =>
      expect(router.state.resolvedLocation?.pathname).toBe("/a"),
    );
    expect(window.scrollY).toBe(600);
  });

  // The router treats a link to the current URL as a refresh and puts the
  // page back where it was; that's why the tab bar handles this tap itself.
  it("keeps the position on a plain link to the page you're on", async () => {
    scrollDocument(600);
    await tap("plain /a");
    expect(window.scrollY).toBe(600);
  });

  it("scrolls back to the top when you tap the tab you're on", async () => {
    scrollDocument(600);
    const scrollTo = vi.spyOn(window, "scrollTo");
    await tap("/a");
    expect(scrollTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ top: 0 }),
    );
    await vi.waitFor(() => expect(window.scrollY).toBe(0));
    expect(router.state.resolvedLocation?.pathname).toBe("/a");
  });
});
