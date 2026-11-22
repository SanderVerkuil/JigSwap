// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import type { PlaySceneProps } from "./play-scene";

// The device gate and the 3D scene are stubbed: this covers the flat row and when the scene mounts.
const gate = vi.hoisted(() => ({
  deviceAllows3D: true,
  webgl: true,
  probes: 0,
}));
vi.mock("@/components/common/three-gate", () => ({
  useDeviceAllows3D: () => gate.deviceAllows3D,
  supportsWebGL: () => {
    gate.probes++;
    return gate.webgl;
  },
}));
vi.mock("@/compat/link", () => ({
  Link: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children?: ReactNode;
    [prop: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// The fake scene reports its first frame and its return when told to, like the real one does.
const scene: Partial<PlaySceneProps> = {};
vi.mock("./play-scene", () => ({
  default: (props: PlaySceneProps) => {
    Object.assign(scene, props);
    return <div data-scene="" data-returns={props.returnNonce} />;
  },
}));

const { Shelf } = await import("./shelf");
type ShelfBox = import("./box-face").ShelfBox;

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const boxes = [
  {
    id: "a",
    title: "Dorpsstraat",
    pieceCount: 1000,
    cover: "/art/a.webp",
    href: "/copies/a",
  },
  { id: "b", title: "Molen", brand: "Studio", pieceCount: 2000 },
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  gate.deviceAllows3D = true;
  gate.webgl = true;
  gate.probes = 0;
  for (const key of Object.keys(scene))
    delete scene[key as keyof PlaySceneProps];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function render(play = true, items: ShelfBox[] = boxes) {
  await act(async () => {
    root.render(
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <Shelf boxes={items} label="Ann's shelf" play={play} />
      </IntlProvider>,
    );
  });
}

const sceneEl = () => container.querySelector("[data-scene]");
const button = () => container.querySelector("button");
const row = () => container.querySelector("ul")!.parentElement!.parentElement!;

describe("Shelf at rest", () => {
  it("is a named list of boxes standing on the ledge, a box with an href opening it", async () => {
    await render();
    const list = container.querySelector("ul")!;
    expect(list.getAttribute("aria-label")).toBe("Ann's shelf");
    const link = list.querySelector("a")!;
    expect(link.getAttribute("href")).toBe("/copies/a");
    expect(link.getAttribute("aria-label")).toBe("Dorpsstraat");
    expect(link.querySelector("img")?.getAttribute("alt")).toBe("");
    expect(container.querySelector("[data-shelf-ledge]")).not.toBeNull();
  });

  it("paints a lid, lettered with brand, title and pieces, for a box without a cover", async () => {
    await render();
    const lid = container
      .querySelectorAll("li")[1]
      .querySelector("[data-shelf-box]")!;
    expect(lid.tagName).toBe("SPAN");
    expect(lid.textContent).toBe("StudioMolen2,000");
  });

  it("tries a replaced cover after one failed to load", async () => {
    await render();
    const img = container.querySelector("img")!;
    await act(async () => {
      img.dispatchEvent(new Event("error"));
    });
    expect(container.querySelector("img")).toBeNull();
    await render(true, [{ ...boxes[0], cover: "/art/a-new.webp" }, boxes[1]]);
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "/art/a-new.webp",
    );
  });

  it("turns a cover that fails to load into a lid", async () => {
    await render();
    const img = container.querySelector("img")!;
    await act(async () => {
      img.dispatchEvent(new Event("error"));
    });
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelectorAll("li")[0].textContent).toContain(
      "Dorpsstraat",
    );
  });
});

describe("Shelf Play", () => {
  it("hands focus to Reset when the scene covers the box that had it", async () => {
    await render();
    await act(async () => button()!.click());
    const link = container.querySelector<HTMLAnchorElement>("ul a")!;
    link.focus();
    expect(document.activeElement).toBe(link);
    await act(async () => scene.onFirstFrame!());
    expect(document.activeElement).toBe(button());
    expect(button()?.textContent).toBe("Reset");
  });

  it("ends the game when the row scrolls while the scene loads, as a resize does", async () => {
    await render();
    await act(async () => button()!.click());
    expect(sceneEl()).not.toBeNull();
    await act(async () => {
      row().dispatchEvent(new Event("scroll"));
    });
    expect(sceneEl()).toBeNull();
    expect(button()?.textContent).toBe("Play");
  });

  it("loads the 3D scene only on Play, probing WebGL then, and turns into Reset", async () => {
    await render();
    expect(sceneEl()).toBeNull();
    expect(gate.probes).toBe(0);
    expect(button()?.textContent).toBe("Play");
    expect(button()?.getAttribute("aria-label")).toBe("Play with the shelf");

    await act(async () => button()!.click());
    expect(gate.probes).toBe(1);
    expect(sceneEl()).not.toBeNull();
    // Still loading: the row stays and Play can't be pressed twice.
    expect(row().style.opacity).toBe("1");
    expect(button()?.getAttribute("aria-disabled")).toBe("true");

    await act(async () => scene.onFirstFrame!());
    expect(row().style.opacity).toBe("0");
    expect(row().hasAttribute("inert")).toBe(true);
    expect(button()?.textContent).toBe("Reset");
    expect(button()?.getAttribute("aria-label")).toBe("Reset the shelf");
  });

  it("returns the boxes, fades the row back in and drops the scene", async () => {
    vi.useFakeTimers();
    await render();
    await act(async () => button()!.click());
    await act(async () => scene.onFirstFrame!());
    await act(async () => button()!.click());
    expect(sceneEl()?.getAttribute("data-returns")).toBe("1");
    expect(button()?.getAttribute("aria-disabled")).toBe("true");

    await act(async () => scene.onReturned!());
    // The row fades in over the matching flat scene, which then goes.
    expect(row().style.opacity).toBe("1");
    expect(sceneEl()).not.toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(sceneEl()).toBeNull();
    expect(row().hasAttribute("inert")).toBe(false);
    expect(button()?.textContent).toBe("Play");
    vi.useRealTimers();
  });

  it("keeps the row's boxes opening while the scene loads, and again as it hands back", async () => {
    vi.useFakeTimers();
    await render();
    const layer = () => sceneEl()!.parentElement!;
    await act(async () => button()!.click());
    // Loading: the row stays live, and its clicks go through the scene's empty canvas.
    expect(row().hasAttribute("inert")).toBe(false);
    expect(layer().hasAttribute("inert")).toBe(true);

    await act(async () => scene.onFirstFrame!());
    expect(row().hasAttribute("inert")).toBe(true);
    expect(layer().hasAttribute("inert")).toBe(false);

    await act(async () => button()!.click());
    await act(async () => scene.onReturned!());
    // Settling: the row is back in charge while the flat scene still covers it.
    expect(row().hasAttribute("inert")).toBe(false);
    expect(layer().hasAttribute("inert")).toBe(true);
    vi.useRealTimers();
  });

  it("plays a second game after Reset, which doesn't close itself", async () => {
    vi.useFakeTimers();
    await render();
    await act(async () => button()!.click());
    await act(async () => scene.onFirstFrame!());
    await act(async () => button()!.click());
    await act(async () => scene.onReturned!());
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(sceneEl()).toBeNull();

    await act(async () => button()!.click());
    // A fresh scene, with no Reset asked of it.
    expect(sceneEl()?.getAttribute("data-returns")).toBe("0");
    await act(async () => scene.onFirstFrame!());
    expect(button()?.textContent).toBe("Reset");
    vi.useRealTimers();
  });

  it("goes back to the flat row at once when reduced motion turns on mid-game", async () => {
    const listeners: Array<() => void> = [];
    let reduce = false;
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query: string) =>
        ({
          get matches() {
            return reduce && query.includes("prefers-reduced-motion");
          },
          media: query,
          addEventListener: (_: string, fn: () => void) => listeners.push(fn),
          removeEventListener: () => {},
        }) as unknown as MediaQueryList,
    );
    await render();
    await act(async () => button()!.click());
    await act(async () => scene.onFirstFrame!());
    expect(row().hasAttribute("inert")).toBe(true);

    reduce = true;
    await act(async () => listeners.forEach((fn) => fn()));
    expect(sceneEl()).toBeNull();
    expect(row().hasAttribute("inert")).toBe(false);
    expect(row().style.opacity).toBe("1");
    expect(button()).toBeNull();
  });

  it("keeps the flat row and drops Play when the WebGL probe fails", async () => {
    gate.webgl = false;
    await render();
    await act(async () => button()!.click());
    expect(sceneEl()).toBeNull();
    expect(button()).toBeNull();
  });

  it("offers nothing on Save-Data or a low-memory device", async () => {
    gate.deviceAllows3D = false;
    await render();
    expect(button()).toBeNull();
    expect(gate.probes).toBe(0);
  });

  it("offers nothing with reduced motion, or when the shelf asks for none", async () => {
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

    vi.restoreAllMocks();
    await render(false);
    expect(button()).toBeNull();
  });
});
