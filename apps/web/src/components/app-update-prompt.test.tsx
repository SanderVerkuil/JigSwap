// @vitest-environment happy-dom
// A chunk that fails to load means a newer build replaced it, so the prompt offers a reload. Not
// while offline (F75): there the chunk failed because the network is gone, and "A new version of
// JigSwap is available" would be false.
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { act, cleanup, render, screen } from "@testing-library/react";
import { toast } from "sonner";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../locales/en.json";
import { AppUpdatePrompt } from "./app-update-prompt";
import { RouteError } from "./route-error";

vi.mock("sonner", () => ({ toast: vi.fn() }));

const fetchVersion = vi.fn<typeof fetch>();

const setOnline = (online: boolean) => {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    get: () => online,
  });
};

// What the browser throws when a route's code doesn't arrive, and the marker TanStack's
// lazyRouteComponent keeps so it reloads only once for it.
const chunkError = () =>
  new TypeError(
    "Failed to fetch dynamically imported module: https://jigswap.site/assets/trades-1a2b3c.js",
  );
const reloadMarker = `tanstack_router_reload:${chunkError().message}`;

// Vite's preload helper: a failed import dispatches a cancelable vite:preloadError carrying the
// error, then throws the error unless a listener prevented it. Prevented, the import resolves to
// nothing, though it is typed as the module, as Vite's is.
const viteImport = <T,>(load: () => Promise<T>): Promise<T> =>
  load().catch((error: unknown) => {
    const event = Object.assign(
      new Event("vite:preloadError", { cancelable: true }),
      { payload: error },
    );
    window.dispatchEvent(event);
    if (!event.defaultPrevented) throw error;
    return undefined as T;
  });

const failChunkLoad = () => {
  const event = Object.assign(
    new Event("vite:preloadError", { cancelable: true }),
    { payload: chunkError() },
  );
  window.dispatchEvent(event);
  return event;
};

const reload = vi.fn();

beforeEach(() => {
  // The prompt is off on the dev server, which has no version.json.
  vi.stubEnv("DEV", false);
  vi.stubGlobal("__APP_VERSION__", "build-1");
  vi.stubGlobal("fetch", fetchVersion);
  fetchVersion
    .mockReset()
    .mockResolvedValue(Response.json({ version: "build-2" }));
  vi.mocked(toast).mockClear();
  reload.mockReset();
  vi.spyOn(window.location, "reload").mockImplementation(reload);
  setOnline(true);
  render(
    <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
      <AppUpdatePrompt />
    </IntlProvider>,
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "onLine");
  sessionStorage.clear();
});

describe("AppUpdatePrompt after a failed chunk load", () => {
  it("offers the new version while online", () => {
    const event = failChunkLoad();
    expect(toast).toHaveBeenCalledWith(
      en.appUpdate.available,
      expect.objectContaining({ id: "app-update" }),
    );
    // The import error still reaches the router, which reloads into the new build.
    expect(event.defaultPrevented).toBe(false);
    expect(sessionStorage.getItem(reloadMarker)).toBeNull();
  });

  it("says nothing offline, holds the router's reload, and checks once back online", async () => {
    setOnline(false);
    const event = failChunkLoad();
    expect(toast).not.toHaveBeenCalled();
    // The import error still reaches the router, so the route can be loaded again later.
    expect(event.defaultPrevented).toBe(false);
    expect(sessionStorage.getItem(reloadMarker)).toBe("1");
    expect(fetchVersion).not.toHaveBeenCalled();

    setOnline(true);
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    // Online, a chunk that fails again is a newer build: the router may reload into it.
    expect(sessionStorage.getItem(reloadMarker)).toBeNull();
    expect(fetchVersion).toHaveBeenCalledTimes(1);
    // A newer build is really out, so now it says so.
    await vi.waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        en.appUpdate.available,
        expect.objectContaining({ id: "app-update" }),
      ),
    );
  });

  it("leaves a marker the router set itself", async () => {
    sessionStorage.setItem(reloadMarker, "1");
    setOnline(false);
    failChunkLoad();
    setOnline(true);
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    expect(sessionStorage.getItem(reloadMarker)).toBe("1");
  });
});

// Against the installed router: the hold above relies on lazyRouteComponent's sessionStorage
// marker. If an upgrade renames it, these fail rather than the page reloading into the browser's
// offline screen unnoticed.
describe("AppUpdatePrompt with a route whose code didn't arrive", () => {
  async function openTrades(codeArrives: { now: boolean }) {
    const rootRoute = createRootRouteWithContext<{ userId: string | null }>()({
      component: () => <Outlet />,
    });
    const trades = createRoute({
      getParentRoute: () => rootRoute,
      path: "/trades",
      component: lazyRouteComponent(() =>
        viteImport(() =>
          codeArrives.now
            ? Promise.resolve({ default: () => <p>Trades page</p> })
            : Promise.reject(chunkError()),
        ),
      ),
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([trades]),
      history: createMemoryHistory({ initialEntries: ["/trades"] }),
      defaultErrorComponent: RouteError,
      context: { userId: "user_1" },
    });
    await act(async () => {
      render(
        <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
          <RouterProvider router={router} />
        </IntlProvider>,
      );
    });
  }

  beforeEach(() => {
    // React and the router report the caught error; keep the test output clean.
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("offline, shows the offline card instead of reloading, and loads the page once back online", async () => {
    setOnline(false);
    const codeArrives = { now: false };
    await openTrades(codeArrives);
    await vi.waitFor(() =>
      expect(
        screen.getByText(en.common.errorBoundary.offlineTitle),
      ).toBeTruthy(),
    );
    expect(reload).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();

    codeArrives.now = true;
    setOnline(true);
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await vi.waitFor(() =>
      expect(screen.getByText("Trades page")).toBeTruthy(),
    );
    expect(reload).not.toHaveBeenCalled();
  });

  it("online, still lets the router reload into the new build", async () => {
    await openTrades({ now: false });
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(toast).toHaveBeenCalledWith(
      en.appUpdate.available,
      expect.objectContaining({ id: "app-update" }),
    );
  });
});
