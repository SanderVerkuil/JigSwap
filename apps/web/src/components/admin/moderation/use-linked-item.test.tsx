// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useLinkedItem } from "./use-linked-item";

afterEach(cleanup);

const setup = (initial?: string) =>
  renderHook(({ item }) => useLinkedItem(item), {
    initialProps: { item: initial },
  });

describe("useLinkedItem", () => {
  it("counts an item the console did not write", () => {
    const { result, rerender } = setup();
    const start = result.current.linkToken;

    rerender({ item: "a" });
    expect(result.current.linkToken).toBe(start + 1);
    rerender({ item: "b" });
    expect(result.current.linkToken).toBe(start + 2);
  });

  it("does not count the item on arrival, or a re-render with the same item", () => {
    const { result, rerender } = setup("a");
    const start = result.current.linkToken;

    rerender({ item: "a" });
    expect(result.current.linkToken).toBe(start);
  });

  it("does not count the console's own write, which reaches the URL a render later", () => {
    const { result, rerender } = setup("a");
    const start = result.current.linkToken;

    act(() => result.current.noteOwnWrite("b"));
    expect(result.current.linkToken).toBe(start);
    rerender({ item: "b" });
    expect(result.current.linkToken).toBe(start);
  });

  it("does not count the item clearing", () => {
    const { result, rerender } = setup("a");
    const start = result.current.linkToken;

    rerender({ item: undefined });
    expect(result.current.linkToken).toBe(start);
  });

  it("counts a link to the row the console last selected once the item has cleared", () => {
    const { result, rerender } = setup();
    act(() => result.current.noteOwnWrite("a"));
    rerender({ item: "a" });
    const start = result.current.linkToken;

    rerender({ item: undefined }); // A tab switch clears it.
    rerender({ item: "a" });
    expect(result.current.linkToken).toBe(start + 1);
  });
});
