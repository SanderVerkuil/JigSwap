// @vitest-environment happy-dom
import type { CaptureResult } from "posthog-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readAnalyticsConsent } from "./analytics-consent";

const init = vi.fn();
const importSpy = vi.fn();
// Order of the consent calls made on the fake client.
const consentCalls: string[] = [];
const optedOut = { value: false };
const fakePostHog = {
  init,
  set_config: vi.fn((config: { advanced_disable_flags?: boolean }) =>
    consentCalls.push(`flags ${config.advanced_disable_flags ? "off" : "on"}`),
  ),
  reset: vi.fn((resetDeviceId?: boolean) =>
    consentCalls.push(resetDeviceId ? "reset with new device id" : "reset"),
  ),
  opt_out_capturing: vi.fn(() => consentCalls.push("opt_out_capturing")),
  opt_in_capturing: vi.fn(() => consentCalls.push("opt_in_capturing")),
  has_opted_out_capturing: () => optedOut.value,
};

// Fresh module state per test; the posthog-js factory runs (and so importSpy
// fires) only when the loader actually performs the dynamic import.
async function freshLoader(
  factory: () => { default: object } = () => {
    importSpy();
    return { default: fakePostHog };
  },
) {
  vi.resetModules();
  vi.doMock("posthog-js", factory);
  return import("./analytics-client");
}

describe("initPostHog", () => {
  beforeEach(() => {
    init.mockReset();
    importSpy.mockReset();
    vi.stubGlobal("window", {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.doUnmock("posthog-js");
  });

  it("does not import posthog-js without a key", async () => {
    vi.stubEnv("VITE_POSTHOG_KEY", "");
    const { initPostHog, getPostHog } = await freshLoader();

    await expect(initPostHog()).resolves.toBeNull();
    expect(importSpy).not.toHaveBeenCalled();
    expect(getPostHog()).toBeNull();
  });

  it("does not import posthog-js during SSR (no window)", async () => {
    vi.stubEnv("VITE_POSTHOG_KEY", "phc_test");
    vi.stubGlobal("window", undefined);
    const { initPostHog } = await freshLoader();

    await expect(initPostHog()).resolves.toBeNull();
    expect(importSpy).not.toHaveBeenCalled();
  });

  it("does not import posthog-js until consent triggers initPostHog", async () => {
    vi.stubEnv("VITE_POSTHOG_KEY", "phc_test");
    const { getPostHog } = await freshLoader();

    expect(importSpy).not.toHaveBeenCalled();
    expect(getPostHog()).toBeNull();
  });

  it("imports and initialises once, with the privacy filter, and notifies subscribers", async () => {
    vi.stubEnv("VITE_POSTHOG_KEY", "phc_test");
    const { initPostHog, getPostHog, subscribePostHog } = await freshLoader();
    const listener = vi.fn();
    subscribePostHog(listener);

    const [a, b] = await Promise.all([initPostHog(), initPostHog()]);
    await initPostHog();

    expect(importSpy).toHaveBeenCalledTimes(1);
    expect(init).toHaveBeenCalledTimes(1);
    const { sanitizeAnalyticsEvent } = await import("./analytics-privacy");
    expect(init).toHaveBeenCalledWith("phc_test", {
      api_host: "/ingest",
      ui_host: "https://eu.posthog.com",
      defaults: "2025-05-24",
      capture_exceptions: true,
      debug: import.meta.env.DEV,
      opt_out_persistence_by_default: true,
      before_send: [expect.any(Function), sanitizeAnalyticsEvent],
    });
    expect(a).toBe(b);
    expect(getPostHog()).toBe(a);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("resolves to null without throwing when the import is blocked", async () => {
    vi.stubEnv("VITE_POSTHOG_KEY", "phc_test");
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const { initPostHog, getPostHog } = await freshLoader(() => {
      throw new Error("Failed to fetch dynamically imported module");
    });

    await expect(initPostHog()).resolves.toBeNull();
    expect(getPostHog()).toBeNull();
    debug.mockRestore();
  });
});

function clearCookies() {
  for (const part of document.cookie.split(";")) {
    const name = part.split("=")[0]?.trim();
    if (name) {
      document.cookie = `${name}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
    }
  }
}

function cookieNames() {
  return document.cookie
    .split(";")
    .map((part) => part.split("=")[0]?.trim())
    .filter(Boolean);
}

describe("withdrawAnalyticsConsent", () => {
  beforeEach(() => {
    init.mockReset();
    importSpy.mockReset();
    fakePostHog.set_config.mockClear();
    fakePostHog.reset.mockClear();
    fakePostHog.opt_out_capturing.mockClear();
    fakePostHog.opt_in_capturing.mockClear();
    consentCalls.length = 0;
    optedOut.value = false;
    clearCookies();
    localStorage.clear();
    sessionStorage.clear();
    vi.stubEnv("VITE_POSTHOG_KEY", "phc_test");
    // The banner writes the granted cookie before it calls initPostHog.
    document.cookie = "cookieConsent=true; path=/";
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock("posthog-js");
  });

  it("records the refusal and clears PostHog's storage without loading it", async () => {
    document.cookie = "ph_phc_test_posthog=%7B%7D; path=/";
    localStorage.setItem("ph_phc_test_posthog", "{}");
    sessionStorage.setItem("ph_phc_test_window_id", "w1");
    localStorage.setItem("theme", "dark");
    const { withdrawAnalyticsConsent } = await freshLoader();

    await withdrawAnalyticsConsent();

    expect(readAnalyticsConsent(document.cookie)).toBe("denied");
    expect(cookieNames()).toEqual(["cookieConsent"]);
    expect(localStorage.getItem("ph_phc_test_posthog")).toBeNull();
    expect(sessionStorage.getItem("ph_phc_test_window_id")).toBeNull();
    expect(localStorage.getItem("theme")).toBe("dark");
    expect(importSpy).not.toHaveBeenCalled();
  });

  it("resets the identity before opting out, and stops handing out the client", async () => {
    const {
      initPostHog,
      getPostHog,
      subscribePostHog,
      withdrawAnalyticsConsent,
    } = await freshLoader();
    await initPostHog();
    const listener = vi.fn();
    subscribePostHog(listener);

    await withdrawAnalyticsConsent();

    // Flags off first: reset() would otherwise fetch them again for the new
    // identity. reset() clears PostHog's own consent state, so the opt-out
    // must follow it.
    expect(consentCalls).toEqual([
      "flags off",
      "reset with new device id",
      "opt_out_capturing",
    ]);
    expect(getPostHog()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("also shuts down a PostHog that is still loading", async () => {
    const { initPostHog, getPostHog, withdrawAnalyticsConsent } =
      await freshLoader();
    void initPostHog();

    await withdrawAnalyticsConsent();

    expect(consentCalls).toEqual([
      "flags off",
      "reset with new device id",
      "opt_out_capturing",
    ]);
    expect(getPostHog()).toBeNull();
  });

  // The consent store is what the UI calls; these run the real pair of modules.
  it("shuts down once when the consent store withdraws a grant that is still loading", async () => {
    const { getPostHog } = await freshLoader();
    const { grantAnalyticsConsent, withdrawAnalyticsConsent } =
      await import("./analytics-consent");

    const granting = grantAnalyticsConsent();
    withdrawAnalyticsConsent();
    await granting;

    expect(consentCalls).toEqual([
      "flags off",
      "reset with new device id",
      "opt_out_capturing",
    ]);
    expect(readAnalyticsConsent(document.cookie)).toBe("denied");
    expect(getPostHog()).toBeNull();
  });

  it("shuts down when another tab withdrew while posthog-js was loading", async () => {
    const { getPostHog } = await freshLoader();
    const { grantAnalyticsConsent } = await import("./analytics-consent");

    const granting = grantAnalyticsConsent();
    document.cookie = "cookieConsent=false; path=/";
    await granting;

    expect(consentCalls).toEqual([
      "flags off",
      "reset with new device id",
      "opt_out_capturing",
    ]);
    expect(getPostHog()).toBeNull();
  });

  it("opts back in, without an extra event, when consent is granted again", async () => {
    const { initPostHog, getPostHog, withdrawAnalyticsConsent } =
      await freshLoader();
    const posthog = await initPostHog();
    await withdrawAnalyticsConsent();
    optedOut.value = true;
    document.cookie = "cookieConsent=true; path=/";

    consentCalls.length = 0;
    await initPostHog();

    expect(init).toHaveBeenCalledTimes(1);
    expect(consentCalls).toEqual(["flags on", "opt_in_capturing"]);
    expect(fakePostHog.opt_in_capturing).toHaveBeenCalledWith({
      captureEventName: false,
    });
    expect(getPostHog()).toBe(posthog);
  });

  it("lets events through on this tab's own choice when the browser blocks cookies", async () => {
    clearCookies();
    const cookie = vi
      .spyOn(document, "cookie", "set")
      .mockImplementation(() => {});
    try {
      await freshLoader();
      const { grantAnalyticsConsent, withdrawAnalyticsConsent } =
        await import("./analytics-consent");
      await grantAnalyticsConsent();
      const [, config] = init.mock.calls[0] as [
        string,
        { before_send: ((event: CaptureResult) => CaptureResult | null)[] },
      ];
      const requireConsent = config.before_send[0];
      const event: CaptureResult = {
        uuid: "u1",
        event: "$pageview",
        properties: {},
      };

      expect(consentCalls).toEqual([]);
      expect(requireConsent?.(event)).toBe(event);

      withdrawAnalyticsConsent();
      expect(requireConsent?.(event)).toBeNull();
    } finally {
      cookie.mockRestore();
    }
  });

  it("drops every event once consent is gone, even if withdrawn in another tab", async () => {
    const { initPostHog } = await freshLoader();
    await initPostHog();
    const [, config] = init.mock.calls[0] as [
      string,
      { before_send: ((event: CaptureResult) => CaptureResult | null)[] },
    ];
    const requireConsent = config.before_send[0];
    const event: CaptureResult = {
      uuid: "u1",
      event: "$pageview",
      properties: {},
    };

    expect(requireConsent?.(event)).toBe(event);
    // Another tab withdrew: only the shared cookie changed.
    document.cookie = "cookieConsent=false; path=/";
    expect(requireConsent?.(event)).toBeNull();
  });
});
