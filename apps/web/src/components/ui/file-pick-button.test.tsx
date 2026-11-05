// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FilePickButton } from "./file-pick-button";

// A file picker must be reachable and operable from the keyboard (UX-11): a real <button> opens
// a visually hidden input, never a <label> around a display:none input (neither is focusable).

afterEach(cleanup);

const input = () =>
  document.querySelector<HTMLInputElement>("input[type='file']")!;

describe("FilePickButton", () => {
  it("is a named button that opens the hidden file input", () => {
    render(
      <FilePickButton accept="image/*" onFiles={() => {}}>
        Add photo
      </FilePickButton>,
    );
    const button = screen.getByRole("button", { name: "Add photo" });
    expect(button.getAttribute("type")).toBe("button");
    expect(button.closest("label")).toBeNull();

    // The input stays out of the tab order and the accessibility tree, but is not
    // display:none (sr-only keeps it clickable on every browser).
    const el = input();
    expect(el.tabIndex).toBe(-1);
    expect(el.getAttribute("aria-hidden")).toBe("true");
    expect(el.className.split(" ")).toContain("sr-only");
    expect(el.hidden).toBe(false);
    expect(el.closest("label")).toBeNull();
    expect(el.accept).toBe("image/*");

    const click = vi.spyOn(el, "click");
    fireEvent.click(button);
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("hands the picked files over and resets the input so the same file can be picked again", () => {
    const onFiles = vi.fn();
    render(
      <FilePickButton multiple onFiles={onFiles}>
        Add photos
      </FilePickButton>,
    );
    const a = new File(["a"], "a.jpg", { type: "image/jpeg" });
    const b = new File(["b"], "b.jpg", { type: "image/jpeg" });
    expect(input().multiple).toBe(true);

    fireEvent.change(input(), { target: { files: [a, b] } });
    expect(onFiles).toHaveBeenCalledWith([a, b]);
    expect(input().value).toBe("");
  });

  it("ignores an empty pick", () => {
    const onFiles = vi.fn();
    render(<FilePickButton onFiles={onFiles}>Add photo</FilePickButton>);
    fireEvent.change(input(), { target: { files: [] } });
    expect(onFiles).not.toHaveBeenCalled();
  });

  it("disables the button and the input together", () => {
    render(
      <FilePickButton disabled onFiles={() => {}}>
        Add photo
      </FilePickButton>,
    );
    expect(
      (screen.getByRole("button", { name: "Add photo" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(input().disabled).toBe(true);
  });
});

describe("FilePickButton inputRef", () => {
  it("exposes the input so another control can open the same picker", () => {
    const inputRef = createRef<HTMLInputElement>();
    render(
      <FilePickButton inputRef={inputRef} onFiles={() => {}}>
        Add photo
      </FilePickButton>,
    );
    expect(inputRef.current).toBe(input());
  });
});
