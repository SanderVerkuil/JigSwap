// @vitest-environment happy-dom
import { act, cleanup, render } from "@testing-library/react";
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
      <FitToWidth>
        <div data-testid="child" />
      </FitToWidth>,
    );
    const wrapper = getByTestId("child").parentElement?.parentElement;
    if (!wrapper) throw new Error("FitToWidth renders two levels of wrapper");
    return {
      wrapper,
      resize: () => act(() => observers.forEach((notify) => notify())),
    };
  }

  it("keeps the scaled height however often its observer fires", () => {
    const { wrapper, resize } = renderPhonePlank();
    expect(wrapper.style.height).toBe("80px");
    resize();
    resize();
    resize();
    expect(wrapper.style.height).toBe("80px");
  });
});
