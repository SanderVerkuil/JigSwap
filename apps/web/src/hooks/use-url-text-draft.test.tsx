// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUrlTextDraft } from "./use-url-text-draft";

const DELAY = 200;

// A stand-in for the router: `write` records the term the page asks for; the test decides when
// (and whether) the URL actually changes by rerendering with a new `url`.
const mount = (initial: string | undefined) => {
  const write = vi.fn<(term: string | undefined) => void>();
  const hook = renderHook(({ url }) => useUrlTextDraft(url, write, DELAY), {
    initialProps: { url: initial },
  });
  return { write, hook };
};

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useUrlTextDraft", () => {
  it("starts from the URL's term", () => {
    const { hook } = mount("texel");
    expect(hook.result.current.draft).toBe("texel");
  });

  it("writes the trimmed term once typing pauses", () => {
    const { write, hook } = mount(undefined);
    act(() => hook.result.current.change("tex"));
    act(() => hook.result.current.change("texel "));
    expect(hook.result.current.draft).toBe("texel ");
    expect(write).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(DELAY);
    });
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith("texel");
  });

  it("clears the term at once", () => {
    const { write, hook } = mount("texel");
    act(() => hook.result.current.change(" "));
    expect(write).toHaveBeenCalledWith(undefined);
    act(() => {
      vi.advanceTimersByTime(DELAY);
    });
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("keeps what was typed meanwhile when its own write lands", () => {
    const { hook } = mount(undefined);
    act(() => hook.result.current.change("texel"));
    act(() => {
      vi.advanceTimersByTime(DELAY);
    });
    act(() => hook.result.current.change("texel ha"));
    hook.rerender({ url: "texel" });
    expect(hook.result.current.draft).toBe("texel ha");
  });

  it("takes over a term changed from elsewhere (a nav link, a shared link)", () => {
    const { write, hook } = mount("texel");
    hook.rerender({ url: undefined });
    expect(hook.result.current.draft).toBe("");
    hook.rerender({ url: "harbour" });
    expect(hook.result.current.draft).toBe("harbour");
    expect(write).not.toHaveBeenCalled();
  });

  it("drops a pending write when the page goes away", () => {
    const { write, hook } = mount(undefined);
    act(() => hook.result.current.change("texel"));
    hook.unmount();
    act(() => {
      vi.advanceTimersByTime(DELAY);
    });
    expect(write).not.toHaveBeenCalled();
  });
});
