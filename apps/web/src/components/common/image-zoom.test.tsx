// @vitest-environment happy-dom
import type { ComponentProps } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ImageZoom } from "./image-zoom";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = (props: Partial<ComponentProps<typeof ImageZoom>> = {}) =>
  act(() =>
    root.render(
      <ImageZoom
        src="https://example.test/box.jpg"
        alt="Box"
        fill
        {...props}
      />,
    ),
  );

const img = () => container.querySelector("img")!;
const wrapper = () => img().parentElement!;

// happy-dom has no layout: give the wrapper and image a 300px square box at the origin.
const layout = () => {
  for (const el of [wrapper(), img()]) {
    for (const prop of [
      "clientWidth",
      "clientHeight",
      "offsetWidth",
      "offsetHeight",
    ]) {
      Object.defineProperty(el, prop, { configurable: true, value: 300 });
    }
  }
  wrapper().getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 300, height: 300 }) as DOMRect;
};

const pointer = (
  type: string,
  pointerId: number,
  clientX: number,
  clientY: number,
  pointerType = "touch",
) =>
  act(() => {
    img().dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId,
        pointerType,
        clientX,
        clientY,
        button: 0,
      }),
    );
  });

const pinchOpen = () => {
  pointer("pointerdown", 1, 130, 150);
  pointer("pointerdown", 2, 170, 150);
  pointer("pointermove", 1, 90, 150);
  pointer("pointermove", 2, 210, 150);
  pointer("pointerup", 1, 90, 150);
  pointer("pointerup", 2, 210, 150);
};

const touchMove = (fingers: number) => {
  const event = new Event("touchmove", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "touches", {
    value: Array.from({ length: fingers }, () => ({})),
  });
  img().dispatchEvent(event);
  return event.defaultPrevented;
};

describe("ImageZoom touch pinch-zoom", () => {
  it("lets the page pan but not pinch-zoom over the image at 1x", () => {
    render();
    expect(wrapper().className).toContain("touch-pan-x");
    expect(wrapper().className).toContain("touch-pan-y");
    expect(wrapper().className).toContain("overflow-hidden");
    expect(img().style.transform).toBe("");
    // One finger at 1x is the page's (scroll); two fingers are ours.
    expect(touchMove(1)).toBe(false);
    expect(touchMove(2)).toBe(true);
  });

  it("zooms the image inside its box on a two-finger pinch", () => {
    render();
    layout();
    pinchOpen();
    // Fingers 40px → 120px apart: 3x around the centre.
    expect(img().style.transform).toBe("translate(0px, 0px) scale(3)");
    expect(wrapper().className).toContain("touch-none");
    // Zoomed: one-finger moves belong to the image too.
    expect(touchMove(1)).toBe(true);
  });

  it("pans the zoomed image with one finger, within its edges", () => {
    render();
    layout();
    pinchOpen();
    pointer("pointerdown", 3, 150, 150);
    pointer("pointermove", 3, 200, 120);
    expect(img().style.transform).toBe("translate(50px, -30px) scale(3)");
    pointer("pointermove", 3, 900, 150);
    // 300px box at 3x may move at most (900 - 300) / 2 = 300px.
    expect(img().style.transform).toBe("translate(300px, 0px) scale(3)");
  });

  it("double-tap returns to fit", () => {
    render();
    layout();
    pinchOpen();
    pointer("pointerdown", 4, 150, 150);
    pointer("pointerup", 4, 150, 150);
    pointer("pointerdown", 5, 150, 150);
    pointer("pointerup", 5, 150, 150);
    expect(img().style.transform).toBe("");
    expect(wrapper().className).toContain("touch-pan-y");
  });

  it("leaves a mouse alone (hover lens)", () => {
    render();
    layout();
    pointer("pointerdown", 1, 130, 150, "mouse");
    pointer("pointermove", 1, 90, 150, "mouse");
    expect(img().style.transform).toBe("");
  });

  it("does nothing when a parent handles the gestures", () => {
    render({ pinchZoom: false });
    layout();
    expect(wrapper().className).not.toContain("touch-");
    pinchOpen();
    expect(img().style.transform).toBe("");
  });
});
