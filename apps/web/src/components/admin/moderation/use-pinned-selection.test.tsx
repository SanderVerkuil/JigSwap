// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { usePinnedSelection } from "./use-pinned-selection";

type Row = { id: string; title: string };
const row = (id: string, title = `Puzzle ${id}`): Row => ({ id, title });
const getId = (r: Row) => r.id;

type Props = { items: Row[] | undefined; requested?: string };
const setup = (initial: Props) =>
  renderHook(
    ({ items, requested }: Props) =>
      usePinnedSelection(items, getId, requested),
    { initialProps: initial },
  );

describe("usePinnedSelection", () => {
  it("selects nothing while the queue loads, then pins the first row", () => {
    const { result, rerender } = setup({ items: undefined });
    expect(result.current.selectedId).toBeNull();
    expect(result.current.item).toBeUndefined();
    expect(result.current.gone).toBe(false);

    const a = row("a");
    rerender({ items: [a, row("b")] });
    expect(result.current.selectedId).toBe("a");
    expect(result.current.item).toBe(a);
    expect(result.current.nextId).toBe("b");
  });

  it("keeps the pinned row when a new submission arrives at the top", () => {
    const { result, rerender } = setup({ items: [row("a"), row("b")] });
    expect(result.current.selectedId).toBe("a");

    rerender({ items: [row("new"), row("a"), row("b")] });
    expect(result.current.selectedId).toBe("a");
    expect(result.current.item?.id).toBe("a");
    expect(result.current.gone).toBe(false);
  });

  it("follows the requested (URL) row and keeps it when the request is cleared", () => {
    const items = [row("a"), row("b"), row("c")];
    const { result, rerender } = setup({ items, requested: "b" });
    expect(result.current.selectedId).toBe("b");
    expect(result.current.nextId).toBe("c");

    rerender({ items, requested: "c" });
    expect(result.current.selectedId).toBe("c");
    // At the end of the queue the next row is the one before.
    expect(result.current.nextId).toBe("b");

    // A tab switch clears the URL item: coming back shows the same row.
    rerender({ items, requested: undefined });
    expect(result.current.selectedId).toBe("c");
  });

  it("keeps a snapshot when the pinned row disappears, and offers the row that took its place", () => {
    const b = row("b", "Starry Night");
    const { result, rerender } = setup({
      items: [row("a"), b, row("c")],
      requested: "b",
    });

    rerender({ items: [row("a"), row("c")], requested: "b" });
    expect(result.current.gone).toBe(true);
    expect(result.current.selectedId).toBe("b");
    expect(result.current.item).toEqual(b);
    expect(result.current.nextId).toBe("c");

    // The snapshot is the last live version, and the reviewer moves on explicitly.
    rerender({ items: [row("a"), row("c")], requested: "c" });
    expect(result.current.gone).toBe(false);
    expect(result.current.item?.id).toBe("c");
  });

  it("updates the snapshot while the row is live", () => {
    const { result, rerender } = setup({
      items: [row("a", "Old title"), row("b")],
    });
    rerender({ items: [row("a", "New title"), row("b")] });
    rerender({ items: [row("b")] });
    expect(result.current.gone).toBe(true);
    expect(result.current.item?.title).toBe("New title");
    expect(result.current.nextId).toBe("b");
  });

  it("selects nothing once the queue empties, and pins the next arrival", () => {
    const { result, rerender } = setup({ items: [row("a")], requested: "a" });
    rerender({ items: [], requested: "a" });
    expect(result.current.selectedId).toBeNull();
    expect(result.current.gone).toBe(false);

    rerender({ items: [row("z")], requested: "a" });
    expect(result.current.selectedId).toBe("z");
    expect(result.current.gone).toBe(false);
  });

  it("reports a linked row that is not in the queue as gone, without a snapshot", () => {
    const { result } = setup({
      items: [row("a"), row("b")],
      requested: "handled",
    });
    expect(result.current.gone).toBe(true);
    expect(result.current.item).toBeUndefined();
    expect(result.current.nextId).toBe("a");
  });

  it("moves to the neighbour, not 'gone', when the reviewer decided the row here", () => {
    const { result, rerender } = setup({
      items: [row("a"), row("b"), row("c")],
      requested: "b",
    });
    act(() => result.current.expectRemoval("b"));

    rerender({ items: [row("a"), row("c")], requested: "b" });
    expect(result.current.gone).toBe(false);
    expect(result.current.selectedId).toBe("c");

    // The last row decided: the one before it takes over.
    act(() => result.current.expectRemoval("c"));
    rerender({ items: [row("a")], requested: "b" });
    expect(result.current.selectedId).toBe("a");
    expect(result.current.gone).toBe(false);
  });

  it("empties the selection when the reviewer decided the last row, then pins the next arrival", () => {
    const { result, rerender } = setup({ items: [row("a")] });
    act(() => result.current.expectRemoval("a"));
    rerender({ items: [] });
    expect(result.current.selectedId).toBeNull();
    expect(result.current.gone).toBe(false);

    rerender({ items: [row("z")] });
    expect(result.current.selectedId).toBe("z");
  });

  it("reports the row gone again once a failed decision is withdrawn", () => {
    const { result, rerender } = setup({ items: [row("a"), row("b")] });
    act(() => result.current.expectRemoval("a"));
    act(() => result.current.expectRemoval(null));
    rerender({ items: [row("b")] });
    expect(result.current.gone).toBe(true);
    expect(result.current.selectedId).toBe("a");
  });
});
