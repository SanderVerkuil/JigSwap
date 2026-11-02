// @vitest-environment happy-dom
import { act, cleanup, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fitScale, FitToWidth } from "./fit-to-width";

describe("fitScale", () => {
  it("scales down when the child is wider than the container", () => {
    expect(fitScale(360, 500)).toBeCloseTo(0.72, 5);
  });

  it("never scales up past 1 when the container is wider", () => {
    expect(fitScale(800, 500)).toBe(1);
  });

  it("returns 1 when widths are equal", () => {
    expect(fitScale(500, 500)).toBe(1);
  });

  it("guards against a zero / unmeasured container width", () => {
    expect(fitScale(0, 500)).toBe(1);
  });

  it("guards against a zero / unmeasured natural width", () => {
    expect(fitScale(360, 0)).toBe(1);
  });
});

describe("FitToWidth", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // happy-dom has no layout, so this models the two facts the component measures: the wrapper's
  // width, and the child's layout height. A flex child with the default align-items: stretch
  // takes the height of a wrapper that has one; with flex-start it keeps its own.
  function renderPhonePlank() {
    const naturalWidth = 500;
    const naturalHeight = 160;
    const observers: (() => void)[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          observers.push(callback);
        }
        observe() {}
        disconnect() {}
      },
    );
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(250);
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(
      naturalWidth,
    );
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
      function (this: HTMLElement) {
        const wrapper = this.parentElement;
        const height = wrapper ? parseFloat(wrapper.style.height) : NaN;
        return wrapper?.style.alignItems !== "flex-start" && height >= 0
          ? height
          : naturalHeight;
      },
    );
    const { getByTestId } = render(
      <FitToWidth natural={{ width: naturalWidth, height: naturalHeight }}>
        <div data-testid="child" />
      </FitToWidth>,
    );
    const inner = getByTestId("child").parentElement;
    const wrapper = inner?.parentElement;
    if (!inner || !wrapper) {
      throw new Error("FitToWidth renders two levels of wrapper");
    }
    return {
      wrapper,
      inner,
      resize: () => act(() => observers.forEach((notify) => notify())),
    };
  }

  // The server doesn't know the width: drawn at natural size, the plank would be cropped and tall
  // until hydration, and only then shrink and move the page.
  it("shows nothing before it can measure, and holds the fitted height for it", () => {
    const html = renderToStaticMarkup(
      <FitToWidth natural={{ width: 552, height: 215 }}>
        <div data-testid="child" />
      </FitToWidth>,
    );
    expect(html).toContain("visibility:hidden");
    expect(html).toContain("aspect-ratio:552 / 215");
    // Wider than the plank it isn't scaled up, so it never needs more than its own height.
    expect(html).toContain("max-height:215px");
  });

  it("shows the child once measured, at the height the measure gave", () => {
    const { wrapper, inner } = renderPhonePlank();
    expect(inner.style.visibility).toBe("");
    expect(wrapper.style.height).toBe("80px");
    expect(wrapper.style.aspectRatio).toBe("");
    expect(wrapper.style.maxHeight).toBe("");
  });

  it("keeps the scaled height however often its observer fires", () => {
    const { wrapper, resize } = renderPhonePlank();
    expect(wrapper.style.height).toBe("80px");
    resize();
    resize();
    resize();
    expect(wrapper.style.height).toBe("80px");
  });
});
