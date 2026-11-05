// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TabCount } from "./underline-tabs";

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
