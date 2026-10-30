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
  const page = (path: string) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path,
      component: () => <p>{path}</p>,
    });
  return createRouter({
    routeTree: rootRoute.addChildren([page("/a"), page("/b")]),
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

  it("ignores a search-only change on the same page", async () => {
    byId("nav-link").focus();
    await go(() => router.history.push("/a?tab=find"), "/a");
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(region().textContent).toBe("");
    expect(document.activeElement).toBe(byId("nav-link"));
  });
});
