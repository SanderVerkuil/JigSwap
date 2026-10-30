// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMinWidth } from "./use-min-width";

// A controllable matchMedia: `matches` is whatever the test says, and changes notify listeners.
const installMatchMedia = (initial: boolean) => {
  let matches = initial;
  const listeners = new Set<() => void>();
  const queries: string[] = [];
  vi.stubGlobal("matchMedia", (query: string) => {
    queries.push(query);
    return {
      get matches() {
        return matches;
      },
      addEventListener: (_: string, cb: () => void) => listeners.add(cb),
      removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
    };
  });
  return {
    queries,
    set(next: boolean) {
      matches = next;
      listeners.forEach((cb) => cb());
    },
  };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function Probe() {
  return <span>{useMinWidth("64rem") ? "wide" : "narrow"}</span>;
}

describe("useMinWidth", () => {
  it("renders the wide (desktop) layout on the server, whatever the window says", () => {
    installMatchMedia(false);
    expect(renderToStaticMarkup(<Probe />)).toBe("<span>wide</span>");
  });

  it("follows the min-width media query across a breakpoint crossing", () => {
    const media = installMatchMedia(false);
    const { result } = renderHook(() => useMinWidth("64rem"));
    expect(result.current).toBe(false);
    expect(media.queries).toContain("(min-width: 64rem)");

    act(() => media.set(true));
    expect(result.current).toBe(true);
  });
});
