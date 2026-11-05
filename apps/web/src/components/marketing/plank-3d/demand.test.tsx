// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invalidate = vi.hoisted(() => vi.fn());
vi.mock("@react-three/fiber", () => ({
  useThree: <T,>(select: (state: { invalidate: () => void }) => T) =>
    select({ invalidate }),
}));

const { DemandFrames, frameDelta } = await import("./demand");

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let source: HTMLDivElement;
let root: Root;

beforeEach(() => {
  invalidate.mockClear();
  container = document.createElement("div");
  source = document.createElement("div");
  document.body.append(container, source);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  source.remove();
});

const render = (props: {
  pointer: boolean;
  visible?: boolean;
  theme?: "light" | "dark";
}) =>
  act(() =>
    root.render(
      <DemandFrames
        eventSource={{ current: source }}
        pointer={props.pointer}
        visible={props.visible ?? true}
        theme={props.theme ?? "light"}
      />,
    ),
  );

const move = (pointerType: string) =>
  source.dispatchEvent(
    new PointerEvent("pointermove", { bubbles: true, pointerType }),
  );

describe("frameDelta", () => {
  it("passes normal frame times through", () => {
    expect(frameDelta(1 / 60)).toBeCloseTo(1 / 60);
  });

  it("caps the first frame after an idle stretch", () => {
    // A demand canvas that slept for 30 s must not jump its damping to the end.
    expect(frameDelta(30)).toBeCloseTo(1 / 30);
  });
});

describe("DemandFrames", () => {
  it("asks for a frame on mouse and pen moves, not on touch", () => {
    render({ pointer: true });
    invalidate.mockClear();
    move("touch");
    expect(invalidate).not.toHaveBeenCalled();
    move("mouse");
    move("pen");
    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  it("ignores pointer moves when parallax is off", () => {
    render({ pointer: false });
    invalidate.mockClear();
    move("mouse");
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("asks for a frame when the theme flips or the canvas scrolls back into view", () => {
    render({ pointer: false });
    invalidate.mockClear();
    render({ pointer: false, theme: "dark" });
    expect(invalidate).toHaveBeenCalledTimes(1);
    render({ pointer: false, theme: "dark", visible: false });
    invalidate.mockClear();
    render({ pointer: false, theme: "dark", visible: true });
    expect(invalidate).toHaveBeenCalledTimes(1);
  });
});
