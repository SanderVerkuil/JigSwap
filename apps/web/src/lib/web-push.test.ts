// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tearDownPushForSignOut } from "./web-push";

// A browser with a service worker whose push subscription (if any) records its unsubscribe.
const stubPushBrowser = (endpoint: string | null, events: string[]) => {
  const subscription =
    endpoint === null
      ? null
      : {
          endpoint,
          unsubscribe: vi.fn(async () => {
            events.push("unsubscribe");
            return true;
          }),
        };
  const registration = {
    pushManager: { getSubscription: async () => subscription },
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
  return subscription;
};

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "serviceWorker");
});

describe("tearDownPushForSignOut", () => {
  it("unsubscribes this browser, then unregisters its endpoint", async () => {
    const events: string[] = [];
    stubPushBrowser("https://fcm.googleapis.com/fcm/send/me", events);
    const unregister = vi.fn(async (endpoint: string) => {
      events.push(`unregister ${endpoint}`);
    });

    await tearDownPushForSignOut(unregister);

    expect(events).toEqual([
      "unsubscribe",
      "unregister https://fcm.googleapis.com/fcm/send/me",
    ]);
  });

  it("makes no server call when this browser holds no subscription", async () => {
    stubPushBrowser(null, []);
    const unregister = vi.fn(async () => {});

    await tearDownPushForSignOut(unregister);

    expect(unregister).not.toHaveBeenCalled();
  });

  it("does nothing in a browser without push", async () => {
    const unregister = vi.fn(async () => {});
    await expect(tearDownPushForSignOut(unregister)).resolves.toBeUndefined();
    expect(unregister).not.toHaveBeenCalled();
  });

  it("resolves when the server unregister fails", async () => {
    const events: string[] = [];
    const subscription = stubPushBrowser("https://push.example/me", events);
    const unregister = vi.fn(async () => {
      throw new Error("offline");
    });

    await expect(tearDownPushForSignOut(unregister)).resolves.toBeUndefined();
    expect(subscription?.unsubscribe).toHaveBeenCalled();
  });

  it("gives up after the time budget when the server never answers", async () => {
    vi.useFakeTimers();
    stubPushBrowser("https://push.example/me", []);
    const unregister = vi.fn(() => new Promise<never>(() => {}));
    let settled = false;

    const teardown = tearDownPushForSignOut(unregister, 3000).then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(2999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await teardown;
    expect(settled).toBe(true);
  });
});
