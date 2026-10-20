// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Tabs, TabsList, TabsTrigger } from "./tabs";
import {
  overflowEdges,
  scrollLeftToReveal,
  wheelScrollDelta,
} from "./tabs-scroll";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// A 300px-wide list holding 500px of tabs.
const metrics = (scrollLeft: number) => ({
  scrollLeft,
  clientWidth: 300,
  scrollWidth: 500,
});

describe("overflowEdges", () => {
  it("fades only the end at the start, both in the middle, only the start at the end", () => {
    expect(overflowEdges(metrics(0))).toEqual({ start: false, end: true });
    expect(overflowEdges(metrics(100))).toEqual({ start: true, end: true });
    expect(overflowEdges(metrics(200))).toEqual({ start: true, end: false });
  });

  it("ignores sub-pixel overflow and lists that fit", () => {
    expect(
      overflowEdges({ scrollLeft: 0, clientWidth: 300, scrollWidth: 300.5 }),
    ).toEqual({ start: false, end: false });
  });
});

describe("scrollLeftToReveal", () => {
  it("leaves a tab that is already in view where it is", () => {
    expect(scrollLeftToReveal(metrics(0), 100, 200, 32)).toBe(0);
  });

  it("scrolls forward just enough to show a tab past the end, with margin", () => {
    // Tab at 380–460: its end plus 32px margin must fit in the 300px viewport.
    expect(scrollLeftToReveal(metrics(0), 380, 460, 32)).toBe(192);
  });

  it("scrolls back to show a tab before the start, with margin", () => {
    expect(scrollLeftToReveal(metrics(200), 100, 180, 32)).toBe(68);
  });

  it("clamps to the scrollable range", () => {
    expect(scrollLeftToReveal(metrics(150), 10, 90, 32)).toBe(0);
    expect(scrollLeftToReveal(metrics(0), 420, 500, 32)).toBe(200);
  });
});

describe("wheelScrollDelta", () => {
  it("turns a vertical wheel into a sideways scroll while the list can move", () => {
    expect(wheelScrollDelta(metrics(0), 0, 40)).toBe(40);
    expect(wheelScrollDelta(metrics(100), 0, -40)).toBe(-40);
  });

  it("lets the page scroll at the matching end", () => {
    expect(wheelScrollDelta(metrics(200), 0, 40)).toBeNull();
    expect(wheelScrollDelta(metrics(0), 0, -40)).toBeNull();
  });

  it("leaves horizontal gestures to the browser", () => {
    expect(wheelScrollDelta(metrics(0), 30, 10)).toBeNull();
  });

  it("does nothing for a list that fits", () => {
    expect(
      wheelScrollDelta(
        { scrollLeft: 0, clientWidth: 300, scrollWidth: 300 },
        0,
        40,
      ),
    ).toBeNull();
  });
});

describe("TabsList overflow", () => {
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
    vi.restoreAllMocks();
  });

  // happy-dom has no layout: give the list a 300px viewport over 500px of content, and each of the
  // five 100px tabs its box, so the hook's measurements are real numbers.
  const fakeLayout = () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(300);
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(500);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        const index = Number(this.dataset.index ?? -1);
        const left =
          index < 0 ? 0 : index * 100 - this.parentElement!.scrollLeft;
        return DOMRect.fromRect({
          x: left,
          y: 0,
          width: index < 0 ? 300 : 100,
          height: 40,
        });
      },
    );
  };

  const render = (value: string) =>
    act(() =>
      root.render(
        <Tabs value={value}>
          <TabsList>
            {["a", "b", "c", "d", "e"].map((tab, index) => (
              <TabsTrigger key={tab} value={tab} data-index={index}>
                {tab}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>,
      ),
    );

  it("marks the edge with more tabs and scrolls an off-screen active tab into view", async () => {
    fakeLayout();
    const scrollTo = vi
      .spyOn(HTMLElement.prototype, "scrollTo")
      .mockImplementation(function (
        this: HTMLElement,
        options?: ScrollToOptions | number,
      ) {
        if (typeof options === "object") this.scrollLeft = options.left ?? 0;
      });

    render("a");
    const list = container.querySelector<HTMLElement>('[role="tablist"]')!;
    expect(list.hasAttribute("data-overflow-start")).toBe(false);
    expect(list.hasAttribute("data-overflow-end")).toBe(true);
    expect(scrollTo).not.toHaveBeenCalled();

    // Selecting the last tab (400–500) brings it into view at the end of the list.
    render("e");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(scrollTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ left: 200 }),
    );
    expect(list.scrollLeft).toBe(200);
    expect(list.hasAttribute("data-overflow-start")).toBe(true);
    expect(list.hasAttribute("data-overflow-end")).toBe(false);
  });
});
