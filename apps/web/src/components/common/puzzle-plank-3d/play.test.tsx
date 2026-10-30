// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../../locales/en.json";
import type { PlankSceneProps } from "./scene";

// Device gate and scenes are stubbed: this covers only when each scene mounts.
const gate = vi.hoisted(() => ({ canLoad3D: true, webgl: true }));
vi.mock("@/components/common/three-gate", () => ({
  useCanLoad3D: () => gate.canLoad3D,
  useWebGLSupport: (enabled: boolean) => enabled && gate.webgl,
}));
vi.mock("@/components/marketing/plank-3d/palette", () => ({
  resolveCssColor: () => "#888888",
  resolveHeadingFont: () => "sans-serif",
}));

// Each fake scene reports its first frame when told to, like FirstFrame does.
const firstFrame: Record<string, () => void> = {};
function fakeScene(name: string) {
  return function FakeScene(props: PlankSceneProps) {
    firstFrame[name] = props.onFirstFrame;
    return <div data-scene={name} />;
  };
}
vi.mock("./scene", () => ({ default: fakeScene("static") }));
vi.mock("./scene-physics", () => ({ default: fakeScene("physics") }));

const { PuzzlePlank3D } = await import("./index");

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const boxes = [{ title: "Sunset", width: 116, height: 144 }];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  gate.canLoad3D = true;
  gate.webgl = true;
  for (const key of Object.keys(firstFrame)) delete firstFrame[key];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function render(interactive = true) {
  await act(async () => {
    root.render(
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <PuzzlePlank3D boxes={boxes} interactive={interactive} />
      </IntlProvider>,
    );
  });
}

const scene = (name: string) => container.querySelector(`[data-scene=${name}]`);
const button = () => container.querySelector("button");
const shelf = () => container.firstElementChild as HTMLElement;

async function frame(name: string) {
  await act(async () => firstFrame[name]());
}

async function pointerDown(target: Element, pointerType: string) {
  await act(async () => {
    target.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, pointerType }),
    );
  });
}

describe("PuzzlePlank3D physics on request", () => {
  it("shows the static scene with Play, and loads physics only on Play", async () => {
    await render();
    await frame("static");
    expect(scene("static")).not.toBeNull();
    expect(scene("physics")).toBeNull();
    expect(button()?.textContent).toBe("Play");

    await act(async () => button()!.click());
    expect(scene("physics")).not.toBeNull();
    // Still loading: the static scene stays and Play can't be pressed twice.
    expect(scene("static")).not.toBeNull();
    expect(button()?.getAttribute("aria-disabled")).toBe("true");

    await frame("physics");
    expect(button()?.textContent).toBe("Reset");
    expect(button()?.hasAttribute("aria-disabled")).toBe(false);
  });

  it("retires the static scene once it has faded out under physics", async () => {
    await render();
    await frame("static");
    await act(async () => button()!.click());
    await frame("physics");
    const staticWrapper = scene("static")!.parentElement!;
    expect(staticWrapper.style.opacity).toBe("0");
    await act(async () => {
      staticWrapper.dispatchEvent(
        new Event("transitionend", { bubbles: true }),
      );
    });
    expect(scene("static")).toBeNull();
    expect(scene("physics")).not.toBeNull();
  });

  it("loads physics on a mouse press on the shelf, never on a touch", async () => {
    await render();
    await pointerDown(shelf(), "touch");
    expect(scene("physics")).toBeNull();
    await pointerDown(shelf(), "mouse");
    expect(scene("physics")).not.toBeNull();
  });

  it("offers Play over the CSS plank where 3D is gated off, without the static scene", async () => {
    gate.canLoad3D = false;
    await render();
    expect(scene("static")).toBeNull();
    expect(button()?.textContent).toBe("Play");
    await act(async () => button()!.click());
    expect(scene("physics")).not.toBeNull();
  });

  it("offers nothing without WebGL, with reduced motion, or on a static shelf", async () => {
    gate.webgl = false;
    await render();
    expect(button()).toBeNull();

    gate.webgl = true;
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query: string) =>
        ({
          matches: query.includes("prefers-reduced-motion"),
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as unknown as MediaQueryList,
    );
    await render();
    expect(button()).toBeNull();
    await pointerDown(shelf(), "mouse");
    expect(scene("physics")).toBeNull();

    vi.restoreAllMocks();
    await render(false);
    expect(button()).toBeNull();
    await pointerDown(shelf(), "mouse");
    expect(scene("physics")).toBeNull();
  });
});
