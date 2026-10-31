// @vitest-environment happy-dom
import {
  createMemoryHistory,
  createRootRoute,
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

function makeRouter(failures: Failures) {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
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
  });
}

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
  });

  async function show(locale: keyof typeof catalogs, failures: Failures) {
    const router = makeRouter(failures);
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
});
