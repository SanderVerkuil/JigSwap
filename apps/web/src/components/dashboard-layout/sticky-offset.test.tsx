// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useHeightCssVar } from "./sticky-offset";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const VAR = "--test-bar-height";

function Bar() {
  return <header ref={useHeightCssVar(VAR)} />;
}

describe("useHeightCssVar", () => {
  let container: HTMLDivElement;
  let root: Root;
  let height = 0;
  let observed: ResizeObserverCallback | undefined;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    height = 0;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      () => DOMRect.fromRect({ x: 0, y: 0, width: 390, height }),
    );
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          observed = callback;
        }
        observe() {}
        disconnect() {
          observed = undefined;
        }
      },
    );
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const cssVar = () => document.documentElement.style.getPropertyValue(VAR);

  it("publishes the bar's height on <html>, follows resizes, and clears it on unmount", () => {
    // A 56px bar plus a 47px safe-area inset and its 1px border.
    height = 104;
    act(() => root.render(<Bar />));
    expect(cssVar()).toBe("104px");

    // The page head grows a breadcrumb row.
    height = 86.5;
    act(() => observed?.([], {} as ResizeObserver));
    expect(cssVar()).toBe("86.5px");

    act(() => root.render(<></>));
    expect(cssVar()).toBe("");
    expect(observed).toBeUndefined();
  });
});
