// @vitest-environment happy-dom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PushSignOutGuard } from "./push-signout-guard";

type ClerkState = { isLoaded: boolean; isSignedIn: boolean | undefined };

// What Clerk's useAuth and useUser report. They agree once clerk-js has loaded.
// Before that, when the SSR state disagrees with the browser, useAuth already
// says "loaded, signed out" while useUser, which never reads a user from SSR
// state, still says "not loaded".
const mocks = vi.hoisted(() => ({
  auth: { isLoaded: false, isSignedIn: undefined } as ClerkState,
  user: { isLoaded: false, isSignedIn: undefined } as ClerkState,
}));
function clerkReports(state: ClerkState) {
  mocks.auth = state;
  mocks.user = state;
}

vi.mock("@/compat/clerk", () => ({
  useAuth: () => mocks.auth,
  useUser: () => mocks.user,
}));

// This browser holds a push subscription; `unsubscribe` records the teardown.
const unsubscribe = vi.fn(async () => true);
beforeEach(() => {
  unsubscribe.mockClear();
  const registration = {
    pushManager: {
      getSubscription: async () => ({
        endpoint: "https://fcm.googleapis.com/fcm/send/left-behind",
        unsubscribe,
      }),
    },
  };
  vi.stubGlobal("PushManager", class {});
  vi.stubGlobal("Notification", class {});
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      getRegistration: async () => registration,
      getRegistrations: async () => [registration],
    },
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "serviceWorker");
});

// Lets the guard's async browser calls run before asserting that nothing happened.
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("PushSignOutGuard (SEC-54)", () => {
  it("unsubscribes a subscription left behind once Clerk reports signed out", async () => {
    clerkReports({ isLoaded: true, isSignedIn: false });
    render(<PushSignOutGuard />);
    await waitFor(() => expect(unsubscribe).toHaveBeenCalledTimes(1));
  });

  it("leaves a signed-in member's subscription alone", async () => {
    clerkReports({ isLoaded: true, isSignedIn: true });
    render(<PushSignOutGuard />);
    await settle();
    expect(unsubscribe).not.toHaveBeenCalled();
  });

  it("waits for Clerk to load before deciding", async () => {
    clerkReports({ isLoaded: false, isSignedIn: undefined });
    const { rerender } = render(<PushSignOutGuard />);
    await settle();
    expect(unsubscribe).not.toHaveBeenCalled();

    clerkReports({ isLoaded: true, isSignedIn: false });
    rerender(<PushSignOutGuard />);
    await waitFor(() => expect(unsubscribe).toHaveBeenCalledTimes(1));
  });

  it("ignores the signed-out state SSR reports before clerk-js has loaded", async () => {
    // A signed-in member whose token SSR refused: the HTML's SSR state says
    // signed out, clerk-js has not loaded yet.
    mocks.auth = { isLoaded: true, isSignedIn: false };
    mocks.user = { isLoaded: false, isSignedIn: undefined };
    render(<PushSignOutGuard />);
    await settle();
    expect(unsubscribe).not.toHaveBeenCalled();
  });

  it("tears down when the session ends while the page is open", async () => {
    clerkReports({ isLoaded: true, isSignedIn: true });
    const { rerender } = render(<PushSignOutGuard />);
    await settle();
    expect(unsubscribe).not.toHaveBeenCalled();

    clerkReports({ isLoaded: true, isSignedIn: false });
    rerender(<PushSignOutGuard />);
    await waitFor(() => expect(unsubscribe).toHaveBeenCalledTimes(1));
  });
});
