// @vitest-environment happy-dom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PushSignOutGuard } from "./push-signout-guard";

const mocks = vi.hoisted(() => ({
  auth: { isLoaded: false, isSignedIn: undefined as boolean | undefined },
}));

vi.mock("@/compat/clerk", () => ({ useAuth: () => mocks.auth }));

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
    mocks.auth = { isLoaded: true, isSignedIn: false };
    render(<PushSignOutGuard />);
    await waitFor(() => expect(unsubscribe).toHaveBeenCalledTimes(1));
  });

  it("leaves a signed-in member's subscription alone", async () => {
    mocks.auth = { isLoaded: true, isSignedIn: true };
    render(<PushSignOutGuard />);
    await settle();
    expect(unsubscribe).not.toHaveBeenCalled();
  });

  it("waits for Clerk to load before deciding", async () => {
    mocks.auth = { isLoaded: false, isSignedIn: undefined };
    const { rerender } = render(<PushSignOutGuard />);
    await settle();
    expect(unsubscribe).not.toHaveBeenCalled();

    mocks.auth = { isLoaded: true, isSignedIn: false };
    rerender(<PushSignOutGuard />);
    await waitFor(() => expect(unsubscribe).toHaveBeenCalledTimes(1));
  });

  it("tears down when the session ends while the page is open", async () => {
    mocks.auth = { isLoaded: true, isSignedIn: true };
    const { rerender } = render(<PushSignOutGuard />);
    await settle();
    expect(unsubscribe).not.toHaveBeenCalled();

    mocks.auth = { isLoaded: true, isSignedIn: false };
    rerender(<PushSignOutGuard />);
    await waitFor(() => expect(unsubscribe).toHaveBeenCalledTimes(1));
  });
});
