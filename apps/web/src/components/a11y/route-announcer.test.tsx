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
import { RouteAnnouncer, shouldMoveFocus } from "./route-announcer";
import { MAIN_CONTENT_ID } from "./skip-link";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("shouldMoveFocus", () => {
  let main: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = `
      <header><button id="chrome">Search</button></header>
      <main id="${MAIN_CONTENT_ID}" tabindex="-1"><a id="row" href="/messages/1">Row</a></main>
      <div role="dialog"><input id="palette" /></div>`;
    main = document.getElementById(MAIN_CONTENT_ID)!;
  });
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("moves focus that is lost: nothing, body, or a node that left the page", () => {
    expect(shouldMoveFocus(null, main)).toBe(true);
    expect(shouldMoveFocus(document.body, main)).toBe(true);
    expect(shouldMoveFocus(document.createElement("a"), main)).toBe(true);
  });

  it("moves focus that is still in the chrome or an overlay", () => {
    expect(shouldMoveFocus(document.getElementById("chrome"), main)).toBe(true);
    expect(shouldMoveFocus(document.getElementById("palette"), main)).toBe(
      true,
    );
  });

  it("keeps focus that is already in the main content", () => {
    expect(shouldMoveFocus(document.getElementById("row"), main)).toBe(false);
    expect(shouldMoveFocus(main, main)).toBe(false);
  });

  it("does nothing on a page without a main landmark", () => {
    expect(shouldMoveFocus(document.body, null)).toBe(false);
  });
});

const ROUTE_TITLE = "Items";

// A shell like the app's: chrome outside <main>, a control in <main> that survives route changes
// (the messages inbox list), and the announcer once at the root.
function makeRouter() {
  const rootRoute = createRootRoute({
    component: () => (
      <>
        <nav>
          <a href="/b" id="nav-link">
            Nav
          </a>
        </nav>
        <main id={MAIN_CONTENT_ID} tabIndex={-1}>
          <a href="/b" id="inbox-row">
            Inbox row
          </a>
          <Outlet />
        </main>
        <RouteAnnouncer />
      </>
    ),
  });
  // The dashboard shell's layout route, the one place a page can still rename the tab.
  const shellRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: "_dashboard",
    component: Outlet,
  });
  const page = (path: string, parent: typeof rootRoute | typeof shellRoute) =>
    createRoute({
      getParentRoute: () => parent,
      path,
      head: () => ({ meta: [{ title: ROUTE_TITLE }] }),
      component: () => <p>{path}</p>,
    });
  // A docs page's sections: a heading, and a FAQ question.
  const guide = createRoute({
    getParentRoute: () => rootRoute,
    path: "/guide",
    head: () => ({ meta: [{ title: ROUTE_TITLE }] }),
    component: () => (
      <>
        <h2 id="blurred-photos">Blurred photos</h2>
        <details id="why-blurred">
          <summary>Why is a photo blurred?</summary>
          <p>The check wasn't sure.</p>
        </details>
      </>
    ),
  });
  return createRouter({
    routeTree: rootRoute.addChildren([
      page("/a", rootRoute),
      page("/b", rootRoute),
      guide,
      page("/docs/$slug", rootRoute),
      shellRoute.addChildren([page("/items/$id", shellRoute)]),
    ]),
    history: createMemoryHistory({ initialEntries: ["/a"] }),
  });
}

describe("RouteAnnouncer", () => {
  let container: HTMLDivElement;
  let root: Root;
  let router: ReturnType<typeof makeRouter>;

  const region = () =>
    document.querySelector<HTMLElement>("[data-route-announcer]")!;
  const byId = (id: string) => document.getElementById(id)!;

  beforeEach(async () => {
    document.title = "A page";
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

  // Drive the history directly: this test router's routes aren't the app's registered route tree.
  async function go(move: () => void, pathname: string) {
    await act(async () => move());
    await vi.waitFor(() =>
      expect(router.state.resolvedLocation?.pathname).toBe(pathname),
    );
  }

  it("is a polite status region that says nothing on the first load", () => {
    expect(region().getAttribute("role")).toBe("status");
    expect(region().getAttribute("aria-live")).toBe("polite");
    expect(region().textContent).toBe("");
  });

  it("announces the new page and moves focus from the chrome to the main content", async () => {
    byId("nav-link").focus();
    document.title = "B page";
    await go(() => router.history.push("/b"), "/b");
    await vi.waitFor(() => expect(region().textContent).toBe("B page"));
    expect(document.activeElement).toBe(byId(MAIN_CONTENT_ID));
  });

  it("moves lost focus (on body) to the main content", async () => {
    (document.activeElement as HTMLElement | null)?.blur();
    document.title = "B page";
    await go(() => router.history.push("/b"), "/b");
    await vi.waitFor(() => expect(region().textContent).toBe("B page"));
    expect(document.activeElement).toBe(byId(MAIN_CONTENT_ID));
  });

  it("leaves focus in the main content alone (picking a thread in the inbox list)", async () => {
    byId("inbox-row").focus();
    document.title = "B page";
    await go(() => router.history.push("/b"), "/b");
    await vi.waitFor(() => expect(region().textContent).toBe("B page"));
    expect(document.activeElement).toBe(byId("inbox-row"));
  });

  it("announces Back but does not move focus, so the restored position is kept", async () => {
    document.title = "B page";
    await go(() => router.history.push("/b"), "/b");
    byId("nav-link").focus();
    document.title = "A page";
    await go(() => router.history.back(), "/a");
    await vi.waitFor(() => expect(region().textContent).toBe("A page"));
    expect(document.activeElement).toBe(byId("nav-link"));
  });

  const frames = async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));
  };

  // Outside the shell nothing renames the tab, so a wait would only delay the page's name until
  // after the screen reader has started on the page itself.
  it("speaks a public detail page at once", async () => {
    byId("nav-link").focus();
    document.title = ROUTE_TITLE;
    await go(() => router.history.push("/docs/accounts"), "/docs/accounts");
    await frames();
    expect(region().textContent).toBe(ROUTE_TITLE);
    expect(document.activeElement).toBe(byId(MAIN_CONTENT_ID));
  });

  // A docs search result or cross-link to a section left focus on <main>, at the top of the page,
  // so the first Tab went back up to the breadcrumb.
  describe("at a #hash", () => {
    it("moves focus to the heading it names, without scrolling", async () => {
      byId("nav-link").focus();
      await go(() => router.history.push("/guide#blurred-photos"), "/guide");
      await vi.waitFor(() =>
        expect(document.activeElement).toBe(byId("blurred-photos")),
      );
      expect(byId("blurred-photos").getAttribute("tabindex")).toBe("-1");
    });

    it("moves focus to a FAQ question by its summary", async () => {
      byId("nav-link").focus();
      await go(() => router.history.push("/guide#why-blurred"), "/guide");
      const summary = byId("why-blurred").querySelector("summary");
      await vi.waitFor(() => expect(document.activeElement).toBe(summary));
      expect(summary?.hasAttribute("tabindex")).toBe(false);
    });

    it("moves focus to the main content when the hash names nothing", async () => {
      byId("nav-link").focus();
      await go(() => router.history.push("/guide#gone"), "/guide");
      await vi.waitFor(() =>
        expect(document.activeElement).toBe(byId(MAIN_CONTENT_ID)),
      );
    });
  });

  // A detail page's route title is generic ("My puzzles") until the page's data is in and the shell
  // names the tab after it: speak that name, not the generic title first.
  describe("on a detail route in the shell", () => {
    it("waits for the page to name itself, then speaks that once", async () => {
      document.title = ROUTE_TITLE;
      await go(() => router.history.push("/items/1"), "/items/1");
      await frames();
      expect(region().textContent).toBe("");

      document.title = "Oostenrijk, Tirol";
      await vi.waitFor(() =>
        expect(region().textContent).toBe("Oostenrijk, Tirol"),
      );
    });

    it("doesn't wait for a page whose data was at hand, which has named itself already", async () => {
      document.title = "Oostenrijk, Tirol";
      await go(() => router.history.push("/items/1"), "/items/1");
      await frames();
      expect(region().textContent).toBe("Oostenrijk, Tirol");
    });

    it("still moves focus at once while it waits", async () => {
      byId("nav-link").focus();
      document.title = ROUTE_TITLE;
      await go(() => router.history.push("/items/1"), "/items/1");
      await frames();
      expect(region().textContent).toBe("");
      expect(document.activeElement).toBe(byId(MAIN_CONTENT_ID));
    });

    it("speaks the route's title when the page never names itself", async () => {
      document.title = ROUTE_TITLE;
      await go(() => router.history.push("/items/1"), "/items/1");
      await vi.waitFor(() => expect(region().textContent).toBe(ROUTE_TITLE), {
        timeout: 2000,
      });
    });

    it("speaks a name that lands after the wait", async () => {
      document.title = ROUTE_TITLE;
      await go(() => router.history.push("/items/1"), "/items/1");
      await vi.waitFor(() => expect(region().textContent).toBe(ROUTE_TITLE), {
        timeout: 2000,
      });
      document.title = "Oostenrijk, Tirol";
      await vi.waitFor(() =>
        expect(region().textContent).toBe("Oostenrijk, Tirol"),
      );
    });

    it("doesn't speak a page that named itself on the first load", async () => {
      document.title = "Oostenrijk, Tirol";
      await frames();
      expect(region().textContent).toBe("");
    });

    it("doesn't let a late title from the old page through while leaving", async () => {
      document.title = ROUTE_TITLE;
      await go(() => router.history.push("/items/1"), "/items/1");
      document.title = "Oostenrijk, Tirol";
      await vi.waitFor(() =>
        expect(region().textContent).toBe("Oostenrijk, Tirol"),
      );
      document.title = "B page";
      await go(() => router.history.push("/b"), "/b");
      await vi.waitFor(() => expect(region().textContent).toBe("B page"));
    });
  });

  it("ignores a search-only change on the same page", async () => {
    byId("nav-link").focus();
    await go(() => router.history.push("/a?tab=find"), "/a");
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(region().textContent).toBe("");
    expect(document.activeElement).toBe(byId("nav-link"));
  });
});
