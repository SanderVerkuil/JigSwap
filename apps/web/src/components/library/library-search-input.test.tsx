// @vitest-environment happy-dom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LibrarySearchInput,
  SEARCH_COMMIT_DELAY_MS,
} from "./library-search-input";

// The box edits a local draft at once and commits it after a pause; the committed value (the URL
// on My Puzzles) can also change from outside, and the box must follow that without losing typing.

const onCommit = vi.fn<(next: string) => void>();

const renderBox = (value: string) =>
  render(
    <LibrarySearchInput
      value={value}
      onCommit={onCommit}
      label="Search your puzzles"
      placeholder="Search"
    />,
  );

const box = () =>
  screen.getByRole("searchbox", {
    name: "Search your puzzles",
  }) as HTMLInputElement;

const type = (text: string) =>
  fireEvent.change(box(), { target: { value: text } });

const wait = () =>
  act(() => {
    vi.advanceTimersByTime(SEARCH_COMMIT_DELAY_MS);
  });

beforeEach(() => {
  vi.useFakeTimers();
  onCommit.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("LibrarySearchInput", () => {
  it("starts from the committed value", () => {
    renderBox("castle");
    expect(box().value).toBe("castle");
  });

  it("commits the trimmed draft once typing pauses", () => {
    renderBox("");
    type("c");
    type("ca");
    type("cat ");
    expect(onCommit).not.toHaveBeenCalled();
    wait();
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("cat");
  });

  it("commits clearing the box", () => {
    renderBox("cat");
    type("");
    wait();
    expect(onCommit).toHaveBeenCalledWith("");
  });

  it("doesn't commit a value that is already committed", () => {
    renderBox("cat");
    type("cat ");
    wait();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("follows a change made elsewhere, dropping a pending commit", () => {
    const { rerender } = renderBox("cat");
    type("cats");
    rerender(
      <LibrarySearchInput
        value=""
        onCommit={onCommit}
        label="Search your puzzles"
        placeholder="Search"
      />,
    );
    expect(box().value).toBe("");
    wait();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("keeps typing that happened while its own commit was on its way", () => {
    const { rerender } = renderBox("");
    type("ca");
    wait();
    expect(onCommit).toHaveBeenLastCalledWith("ca");
    type("cat");
    // The URL catches up with the earlier commit only now.
    rerender(
      <LibrarySearchInput
        value="ca"
        onCommit={onCommit}
        label="Search your puzzles"
        placeholder="Search"
      />,
    );
    expect(box().value).toBe("cat");
    wait();
    expect(onCommit).toHaveBeenLastCalledWith("cat");
  });
});
