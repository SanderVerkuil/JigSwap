// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCoarsePointer } from "./use-coarse-pointer";

// A controllable matchMedia: only "(pointer: coarse)" can match.
function stubPointer(coarse: boolean) {
  let matches = coarse;
  const listeners = new Set<() => void>();
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        media: query,
        get matches() {
          return query === "(pointer: coarse)" && matches;
        },
        addEventListener: (_type: string, fn: () => void) => listeners.add(fn),
        removeEventListener: (_type: string, fn: () => void) =>
          listeners.delete(fn),
      }) as unknown as MediaQueryList,
  );
  return {
    listeners,
    change(next: boolean) {
      matches = next;
      listeners.forEach((fn) => fn());
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useCoarsePointer", () => {
  it("is false with a mouse or trackpad", () => {
    stubPointer(false);
    const { result } = renderHook(() => useCoarsePointer());
    expect(result.current).toBe(false);
  });

  it("is true on a touch screen", () => {
    stubPointer(true);
    const { result } = renderHook(() => useCoarsePointer());
    expect(result.current).toBe(true);
  });

  it("follows a pointer change and unsubscribes on unmount", () => {
    const pointer = stubPointer(false);
    const { result, unmount } = renderHook(() => useCoarsePointer());

    act(() => pointer.change(true));
    expect(result.current).toBe(true);

    unmount();
    expect(pointer.listeners.size).toBe(0);
  });
});
