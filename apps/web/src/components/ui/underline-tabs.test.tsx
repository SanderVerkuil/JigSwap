// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StickyTabsBar, TAB_TRIGGER_CLASS, TabCount } from "./underline-tabs";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("TabCount", () => {
  it("renders nothing until the count is known", () => {
    act(() => root.render(<TabCount count={undefined} />));
    expect(container.textContent).toBe("");
  });

  it("shows an exact count as is, including zero", () => {
    act(() => root.render(<TabCount count={0} />));
    expect(container.textContent).toBe("0");
    act(() => root.render(<TabCount count={7} capped={false} />));
    expect(container.textContent).toBe("7");
  });

  it("shows a count that stopped at its cap as N+", () => {
    act(() => root.render(<TabCount count={50} capped />));
    expect(container.textContent).toBe("50+");
  });
});

describe("TAB_TRIGGER_CLASS", () => {
  // Night Primary (#1f7a63) is 2.5:1 on the night sheet; the underline is the only mark of the
  // current tab, so at night it takes the lifted primary text colour (8.3:1).
  it("underlines the active tab at night in the primary text colour", () => {
    const list = TAB_TRIGGER_CLASS.split(/\s+/);
    expect(list).toContain("dark:data-[state=active]:border-primary-text");
    expect(list).not.toContain("dark:data-[state=active]:border-primary");
  });
});

describe("StickyTabsBar", () => {
  // A puzzle card's ⋯ button and a member tile's actions are `relative z-10`, to sit above the
  // card's stretched link. Scrolling under a bar at that same z-index, the later element wins: the
  // button paints over the tab and takes its taps. It stays under the page head (z-20).
  it("sits above what scrolls under it, and under the page head", () => {
    act(() => root.render(<StickyTabsBar data-testid="bar" />));
    const bar = container.querySelector('[data-testid="bar"]')!;
    const match = /\bz-\[?(\d+)\]?/.exec(bar.className);
    expect(match).not.toBeNull();
    const zIndex = Number(match![1]);
    expect(zIndex).toBeGreaterThan(10);
    expect(zIndex).toBeLessThan(20);
  });
});
