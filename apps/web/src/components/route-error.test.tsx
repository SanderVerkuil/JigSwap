// @vitest-environment happy-dom
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { act, fireEvent, screen } from "@testing-library/react";
import { createRoot, type Root } from "react-dom/client";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../locales/en.json";
import nl from "../../locales/nl.json";
import { RouteError } from "./route-error";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// A route that throws while loading or rendering shows the router's default error component.
// It renders inside Providers, so it speaks the member's language (UX-64), and "Try again"
// re-runs the failed route instead of reloading the whole app.
const catalogs = { en, nl } as const;

// While a flag is set, that part of the route throws (React retries a failed render once, so a
// one-shot failure would never reach the error component).
type Failures = { loader: boolean; render: boolean };

function makeRouter(failures: Failures, userId: string | null = null) {
  const rootRoute = createRootRouteWithContext<{ userId: string | null }>()({
    component: () => <Outlet />,
  });
  const page = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    loader: () => {
      if (failures.loader) throw new Error("Server said no: internal detail");
    },
    component: function Page() {
      if (failures.render) throw new Error("Render broke: internal detail");
      return <p>Page content</p>;
    },
  });
  return createRouter({
    routeTree: rootRoute.addChildren([page]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
    defaultErrorComponent: RouteError,
    context: { userId },
  });
}

// The browser's online state as RouteError reads it (useOnline), flipped by the offline tests.
// They flip the state itself and dispatch no 'online' event: in a browser React re-renders
// between that event's listeners, so the card must retry on the flip, not on the event.
const connection = vi.hoisted(() => {
  let online = true;
  const listeners = new Set<() => void>();
  return {
    isOnline: () => online,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    set: (next: boolean) => {
      online = next;
      for (const listener of listeners) listener();
    },
  };
});
vi.mock("@/lib/use-connection-state", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useOnline: () =>
      useSyncExternalStore(
        connection.subscribe,
        connection.isOnline,
        connection.isOnline,
      ),
  };
});
const setOnline = connection.set;

describe("RouteError", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    // React and the router report the caught error; keep the test output clean.
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    setOnline(true);
  });

  async function show(
    locale: keyof typeof catalogs,
    failures: Failures,
    userId: string | null = null,
  ) {
    const router = makeRouter(failures, userId);
    await act(async () => {
      root.render(
        <IntlProvider
          locale={locale}
          messages={catalogs[locale]}
          timeZone="Europe/Amsterdam"
        >
          <RouterProvider router={router} />
        </IntlProvider>,
      );
    });
  }

  it.each(["en", "nl"] as const)(
    "shows the translated error card in %s, without the raw error text",
    async (locale) => {
      await show(locale, { loader: true, render: false });
      const copy = catalogs[locale].common.errorBoundary;
      await vi.waitFor(() => expect(screen.getByText(copy.title)).toBeTruthy());
      expect(screen.getByText(copy.description)).toBeTruthy();
      expect(screen.getByRole("button", { name: copy.tryAgain })).toBeTruthy();
      expect(screen.getByRole("button", { name: copy.reload })).toBeTruthy();
      expect(screen.queryByText(/internal detail/)).toBeNull();
    },
  );

  it.each(["loader", "render"] as const)(
    "re-runs the route on Try again after a %s error",
    async (part) => {
      const failures = { loader: false, render: false, [part]: true };
      await show("en", failures);
      const tryAgain = await vi.waitFor(() =>
        screen.getByRole("button", {
          name: en.common.errorBoundary.tryAgain,
        }),
      );
      expect(screen.queryByText("Page content")).toBeNull();
      failures[part] = false;
      await act(async () => fireEvent.click(tryAgain));
      await vi.waitFor(() =>
        expect(screen.getByText("Page content")).toBeTruthy(),
      );
    },
  );

  // F76: the card also offers a way out, to where a member or visitor starts.
  it("leads a member back to the dashboard", async () => {
    await show("en", { loader: true, render: false }, "user_1");
    const link = await vi.waitFor(() =>
      screen.getByRole("link", { name: en.notFound.backToDashboard }),
    );
    expect(link.getAttribute("href")).toBe("/dashboard");
  });

  it.each(["en", "nl"] as const)(
    "leads a visitor back home (%s)",
    async (locale) => {
      await show(locale, { loader: true, render: false });
      const link = await vi.waitFor(() =>
        screen.getByRole("link", {
          name: catalogs[locale].notFound.backToHome,
        }),
      );
      expect(link.getAttribute("href")).toBe("/");
    },
  );

  // F75: offline, a page whose code never arrived fails for that reason; say so, and try again
  // once the connection is back.
  it.each(["en", "nl"] as const)(
    "says the member is offline instead of that something went wrong (%s)",
    async (locale) => {
      setOnline(false);
      await show(locale, { loader: true, render: false });
      const copy = catalogs[locale].common.errorBoundary;
      await vi.waitFor(() =>
        expect(screen.getByText(copy.offlineTitle)).toBeTruthy(),
      );
      expect(screen.getByText(copy.offlineDescription)).toBeTruthy();
      expect(screen.queryByText(copy.title)).toBeNull();
      expect(screen.getByRole("button", { name: copy.tryAgain })).toBeTruthy();
    },
  );

  it("loads the page by itself once the browser is back online", async () => {
    setOnline(false);
    const failures = { loader: true, render: false };
    await show("en", failures);
    await vi.waitFor(() =>
      expect(
        screen.getByText(en.common.errorBoundary.offlineTitle),
      ).toBeTruthy(),
    );
    failures.loader = false;
    await act(async () => setOnline(true));
    await vi.waitFor(() =>
      expect(screen.getByText("Page content")).toBeTruthy(),
    );
  });
});
