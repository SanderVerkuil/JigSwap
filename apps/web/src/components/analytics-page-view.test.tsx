// @vitest-environment happy-dom
import { cleanup, render } from "@testing-library/react";
import type { PostHog } from "posthog-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type FakePostHog = Pick<
  PostHog,
  | "__loaded"
  | "capture"
  | "identify"
  | "unsetPersonProperties"
  | "reset"
  | "get_property"
>;

const state = vi.hoisted(() => ({
  clerk: {
    isLoaded: true,
    isSignedIn: true as boolean | undefined,
    user: { id: "user_1" } as { id: string } | null | undefined,
  },
  convex: { isLoading: false, isAuthenticated: true },
  posthog: null as FakePostHog | null,
  userState: "anonymous" as string | undefined,
}));

vi.mock("@/compat/clerk", () => ({ useUser: () => state.clerk }));
vi.mock("@/compat/navigation", () => ({
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/analytics-provider", () => ({
  usePostHog: () => state.posthog,
}));
vi.mock("convex/react", () => ({ useConvexAuth: () => state.convex }));

function fakePostHog(): FakePostHog {
  return {
    __loaded: true,
    capture: vi.fn<PostHog["capture"]>(),
    identify: vi.fn<PostHog["identify"]>(),
    unsetPersonProperties: vi.fn<PostHog["unsetPersonProperties"]>(),
    reset: vi.fn<PostHog["reset"]>(),
    get_property: vi.fn((name: string) =>
      name === "$user_state" ? state.userState : undefined,
    ),
  };
}

// Fresh module per test: the person-property scrub runs once per page load.
async function renderPageView() {
  vi.resetModules();
  const { PostHogPageView } = await import("./analytics-page-view");
  const view = render(<PostHogPageView />);
  return { rerender: () => view.rerender(<PostHogPageView />) };
}

let posthog: FakePostHog;

beforeEach(() => {
  state.clerk = { isLoaded: true, isSignedIn: true, user: { id: "user_1" } };
  state.convex = { isLoading: false, isAuthenticated: true };
  posthog = fakePostHog();
  state.posthog = posthog;
  state.userState = "anonymous";
});
afterEach(cleanup);

describe("PostHogPageView identity", () => {
  it("identifies a signed-in member by their account id only", async () => {
    await renderPageView();
    expect(posthog.identify).toHaveBeenCalledTimes(1);
    expect(vi.mocked(posthog.identify).mock.calls[0]).toEqual(["user_1"]);
  });

  it("removes the email and username earlier versions sent, once per page load", async () => {
    const view = await renderPageView();
    // Clerk hands out a new user object on every session refresh.
    state.clerk = { ...state.clerk, user: { id: "user_1" } };
    view.rerender();
    expect(posthog.unsetPersonProperties).toHaveBeenCalledTimes(1);
    expect(posthog.unsetPersonProperties).toHaveBeenCalledWith([
      "email",
      "username",
    ]);
  });

  it("waits for consent to load PostHog before identifying or scrubbing", async () => {
    state.posthog = null;
    const view = await renderPageView();
    expect(posthog.identify).not.toHaveBeenCalled();

    state.posthog = posthog;
    view.rerender();
    expect(posthog.identify).toHaveBeenCalledWith("user_1");
    expect(posthog.unsetPersonProperties).toHaveBeenCalledTimes(1);
  });

  it("resets an identified PostHog identity once the member is signed out", async () => {
    state.clerk = { isLoaded: true, isSignedIn: false, user: null };
    state.convex = { isLoading: false, isAuthenticated: false };
    state.userState = "identified";
    await renderPageView();
    expect(posthog.reset).toHaveBeenCalledTimes(1);
    expect(posthog.identify).not.toHaveBeenCalled();
  });

  it("keeps an anonymous visitor's identity, and waits for Clerk to load", async () => {
    state.clerk = { isLoaded: true, isSignedIn: false, user: null };
    state.convex = { isLoading: false, isAuthenticated: false };
    await renderPageView();
    cleanup();

    state.clerk = { isLoaded: false, isSignedIn: undefined, user: undefined };
    state.userState = "identified";
    await renderPageView();

    expect(posthog.reset).not.toHaveBeenCalled();
  });
});
