// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUrlSearchInput } from "./use-url-search-input";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const setup = (initial: string | undefined) => {
  const write = vi.fn<(term: string | undefined) => void>();
  const hook = renderHook(
    ({ value }: { value: string | undefined }) =>
      useUrlSearchInput(value, write),
    { initialProps: { value: initial } },
  );
  return { write, ...hook };
};

describe("useUrlSearchInput", () => {
  it("starts from the URL's term and writes nothing on its own", () => {
    const { result, write } = setup("marieke");
    expect(result.current[0]).toBe("marieke");
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(write).not.toHaveBeenCalled();
  });

  it("writes the trimmed term once typing pauses, and undefined when cleared", () => {
    const { result, write, rerender } = setup(undefined);
    act(() => result.current[1]("  ma"));
    act(() => {
      vi.advanceTimersByTime(100);
    });
    act(() => result.current[1]("  mar "));
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(write).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(write).toHaveBeenCalledExactlyOnceWith("mar");

    // The URL catching up with the write keeps what the admin typed (spaces included).
    rerender({ value: "mar" });
    expect(result.current[0]).toBe("  mar ");

    act(() => result.current[1]("   "));
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(write).toHaveBeenLastCalledWith(undefined);
  });

  it("follows a URL change it did not write instead of writing the old text back", () => {
    const { result, write, rerender } = setup("marieke");
    // e.g. the sidebar link to the bare /admin/users page
    rerender({ value: undefined });
    expect(result.current[0]).toBe("");
    rerender({ value: "henk" });
    expect(result.current[0]).toBe("henk");
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(write).not.toHaveBeenCalled();
  });
});
