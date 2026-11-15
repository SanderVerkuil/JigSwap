// @vitest-environment happy-dom
import { cleanup, render } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route } from "./__root";

// Clerk's session as AuthCacheSync reads it, the router it re-runs, and the auth
// the SSR'd root context dehydrated into the page.
const clerk = vi.hoisted(() => ({
  isSignedIn: undefined as boolean | undefined,
}));
const router = vi.hoisted(() => ({ invalidate: vi.fn(), options: {} }));
const context = vi.hoisted(() => ({
  userId: null as string | null,
  intl: { locale: "en" as const, timeZone: "Europe/Amsterdam", now: 0 },
  convexClient: {},
}));

// Providers that only pass their children through.
const { Pass } = vi.hoisted(() => ({
  Pass: ({ children }: { children?: ReactNode }) => children,
}));

vi.mock("@tanstack/react-router", () => ({
  createRootRouteWithContext: () => (options: object) => ({ options }),
  HeadContent: () => null,
  Outlet: () => null,
  Scripts: () => null,
  useRouteContext: () => context,
  useRouter: () => router,
}));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    const builder = { validator: () => builder, handler: (fn: unknown) => fn };
    return builder;
  },
}));
vi.mock("@clerk/tanstack-react-start", () => ({
  ClerkProvider: Pass,
  useAuth: () => ({ isSignedIn: clerk.isSignedIn }),
}));
vi.mock("@clerk/tanstack-react-start/server", () => ({ auth: vi.fn() }));
vi.mock("convex/react-clerk", () => ({ ConvexProviderWithClerk: Pass }));
vi.mock("../components/providers", () => ({ Providers: Pass }));
vi.mock("../components/a11y/route-announcer", () => ({
  RouteAnnouncer: () => null,
}));

const Root = (Route as unknown as { options: { component: ComponentType } })
  .options.component;

// The root renders <html>, so it mounts on the document itself.
const renderRoot = () => render(<Root />, { container: document });

const assign = vi.fn();

beforeEach(() => {
  vi.spyOn(window.location, "assign").mockImplementation(assign);
  // React warns that RootDocument's inline script never runs when the client
  // renders it; on the site the server renders it.
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  assign.mockReset();
  router.invalidate.mockReset();
});

describe("AuthCacheSync", () => {
  // web-1: Browse's loaded lists and the query cache live in memory, keyed without the member.
  it("loads the page afresh when the member's session ends", () => {
    context.userId = "user_parent";
    clerk.isSignedIn = true;
    const { rerender } = renderRoot();

    clerk.isSignedIn = false;
    rerender(<Root />);

    expect(assign).toHaveBeenCalledWith("/");
    expect(router.invalidate).not.toHaveBeenCalled();
  });

  it("re-runs the route guards without a reload when a visitor signs in", () => {
    context.userId = null;
    clerk.isSignedIn = false;
    const { rerender } = renderRoot();

    clerk.isSignedIn = true;
    rerender(<Root />);

    expect(router.invalidate).toHaveBeenCalledOnce();
    expect(assign).not.toHaveBeenCalled();
  });
});
