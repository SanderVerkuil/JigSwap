import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const init = vi.fn();
const importSpy = vi.fn();

// Fresh module state per test; the posthog-js factory runs (and so importSpy
// fires) only when the loader actually performs the dynamic import.
async function freshLoader(
  factory: () => { default: object } = () => {
    importSpy();
    return { default: { init } };
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

  it("imports and initialises once, with the existing config, and notifies subscribers", async () => {
    vi.stubEnv("VITE_POSTHOG_KEY", "phc_test");
    const { initPostHog, getPostHog, subscribePostHog } = await freshLoader();
    const listener = vi.fn();
    subscribePostHog(listener);

    const [a, b] = await Promise.all([initPostHog(), initPostHog()]);
    await initPostHog();

    expect(importSpy).toHaveBeenCalledTimes(1);
    expect(init).toHaveBeenCalledTimes(1);
    expect(init).toHaveBeenCalledWith("phc_test", {
      api_host: "/ingest",
      ui_host: "https://eu.posthog.com",
      defaults: "2025-05-24",
      capture_exceptions: true,
      debug: import.meta.env.DEV,
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
