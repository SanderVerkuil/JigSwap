// @vitest-environment happy-dom
import type { PresenceSettingsView } from "@jigswap/contracts";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  APP_AWAY_ROOM,
  APP_ONLINE_ROOM,
  AppPresence,
  IDLE_AFTER_MS,
  PRESENCE_INTERVAL_MS,
} from "./app-presence";

const mocks = vi.hoisted(() => ({
  settings: undefined as PresenceSettingsView | undefined,
  // Rooms whose stock hook is currently mounted, and every heartbeat-hook render.
  mounted: new Set<string>(),
  renders: [] as { room: string; userId: string; interval: number }[],
}));

vi.mock("@/components/dashboard-home/use-current-member", () => ({
  useCurrentMember: () => ({ member: { _id: "member_me" } }),
}));

vi.mock("./use-presence", () => ({
  usePresenceSettings: () => mocks.settings,
}));

vi.mock("@convex-dev/presence/react", async () => {
  const { useEffect } = await import("react");
  function usePresenceStub(
    _presence: unknown,
    room: string,
    userId: string,
    interval: number,
  ) {
    mocks.renders.push({ room, userId, interval });
    useEffect(() => {
      mocks.mounted.add(room);
      return () => {
        mocks.mounted.delete(room);
      };
    }, [room]);
  }
  return { default: usePresenceStub };
});

const setHidden = (hidden: boolean) => {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => hidden,
  });
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  mocks.settings = { share: true, override: "auto" };
  mocks.mounted.clear();
  mocks.renders.length = 0;
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => false,
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("AppPresence", () => {
  it("mounts app:online while the tab is visible and in use, at a 60 s interval", () => {
    render(<AppPresence />);
    expect([...mocks.mounted]).toEqual([APP_ONLINE_ROOM]);
    expect(mocks.renders.at(-1)).toEqual({
      room: APP_ONLINE_ROOM,
      userId: "member_me",
      interval: PRESENCE_INTERVAL_MS,
    });
    // The backend's maximum (presence.ts MAX_HEARTBEAT_INTERVAL_MS).
    expect(PRESENCE_INTERVAL_MS).toBe(60_000);
  });

  it("heartbeats app:away at the same 60 s interval", () => {
    render(<AppPresence />);
    act(() => {
      vi.advanceTimersByTime(IDLE_AFTER_MS);
    });
    expect([...mocks.mounted]).toEqual([APP_AWAY_ROOM]);
    expect(mocks.renders.at(-1)).toEqual({
      room: APP_AWAY_ROOM,
      userId: "member_me",
      interval: 60_000,
    });
  });

  it("switches to app:away after 5 minutes without input, and back on input", () => {
    render(<AppPresence />);
    act(() => {
      vi.advanceTimersByTime(IDLE_AFTER_MS - 1);
    });
    expect([...mocks.mounted]).toEqual([APP_ONLINE_ROOM]);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    // Exactly one room at a time: online was unmounted (disconnected).
    expect([...mocks.mounted]).toEqual([APP_AWAY_ROOM]);

    act(() => {
      window.dispatchEvent(new Event("pointermove"));
    });
    expect([...mocks.mounted]).toEqual([APP_ONLINE_ROOM]);
  });

  it("restarts the idle countdown on every key or pointer input", () => {
    render(<AppPresence />);
    act(() => {
      vi.advanceTimersByTime(IDLE_AFTER_MS - 1_000);
      window.dispatchEvent(new KeyboardEvent("keydown"));
      vi.advanceTimersByTime(IDLE_AFTER_MS - 1_000);
    });
    expect([...mocks.mounted]).toEqual([APP_ONLINE_ROOM]);
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect([...mocks.mounted]).toEqual([APP_AWAY_ROOM]);
  });

  it("handles a burst of pointer moves without rescheduling the idle timer or re-rendering", () => {
    render(<AppPresence />);
    const renders = mocks.renders.length;
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    act(() => {
      for (let i = 0; i < 200; i++) {
        vi.advanceTimersByTime(16);
        window.dispatchEvent(new Event("pointermove"));
      }
    });
    expect(setTimeoutSpy).not.toHaveBeenCalled();
    expect(clearTimeoutSpy).not.toHaveBeenCalled();
    expect(mocks.renders.length).toBe(renders);
    expect([...mocks.mounted]).toEqual([APP_ONLINE_ROOM]);
    setTimeoutSpy.mockRestore();
    clearTimeoutSpy.mockRestore();
  });

  it("goes away exactly 5 minutes after the last of many inputs", () => {
    render(<AppPresence />);
    act(() => {
      // Input every second for 3 minutes, starting a minute in.
      vi.advanceTimersByTime(60_000);
      for (let i = 0; i < 180; i++) {
        window.dispatchEvent(new Event("pointermove"));
        vi.advanceTimersByTime(1_000);
      }
      // The last input was 1 s ago.
      vi.advanceTimersByTime(IDLE_AFTER_MS - 1_000 - 1);
    });
    expect([...mocks.mounted]).toEqual([APP_ONLINE_ROOM]);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect([...mocks.mounted]).toEqual([APP_AWAY_ROOM]);
  });

  it("doesn't go away while the tab is hidden, and is active again when it shows", () => {
    render(<AppPresence />);
    setHidden(true);
    act(() => {
      vi.advanceTimersByTime(IDLE_AFTER_MS * 2);
    });
    // The stock hook disconnects the hidden tab itself; no switch to away behind its back.
    expect([...mocks.mounted]).toEqual([APP_ONLINE_ROOM]);
    setHidden(false);
    expect([...mocks.mounted]).toEqual([APP_ONLINE_ROOM]);
  });

  it("returns from away to online when the tab shows again", () => {
    render(<AppPresence />);
    act(() => {
      vi.advanceTimersByTime(IDLE_AFTER_MS);
    });
    expect([...mocks.mounted]).toEqual([APP_AWAY_ROOM]);
    setHidden(true);
    setHidden(false);
    expect([...mocks.mounted]).toEqual([APP_ONLINE_ROOM]);
  });

  it("waits for the tab to be visible before the first heartbeat", () => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => true,
    });
    render(<AppPresence />);
    expect(mocks.renders).toEqual([]);
    setHidden(false);
    expect([...mocks.mounted]).toEqual([APP_ONLINE_ROOM]);
  });

  it.each<[string, PresenceSettingsView | undefined]>([
    ["settings still loading", undefined],
    ["never chosen", { share: null, override: "auto" }],
    ["not sharing", { share: false, override: "auto" }],
    ["appearing offline", { share: true, override: "invisible" }],
  ])("never heartbeats when %s", (_label, settings) => {
    mocks.settings = settings;
    render(<AppPresence />);
    act(() => {
      vi.advanceTimersByTime(IDLE_AFTER_MS);
    });
    expect(mocks.renders).toEqual([]);
  });

  it("still heartbeats for a member who chose Away (the server reports them away)", () => {
    mocks.settings = { share: true, override: "away" };
    render(<AppPresence />);
    expect([...mocks.mounted]).toEqual([APP_ONLINE_ROOM]);
  });
});
