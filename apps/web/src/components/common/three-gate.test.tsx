// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deviceAllows3D, type Device3DEnv } from "./three-gate";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const capable: Device3DEnv = { saveData: false, deviceMemory: 8 };

describe("deviceAllows3D", () => {
  it.each<[string, Partial<Device3DEnv>, boolean]>([
    ["a capable device", {}, true],
    ["Save-Data", { saveData: true }, false],
    ["2 GB of device memory", { deviceMemory: 2 }, false],
    ["exactly 4 GB of device memory", { deviceMemory: 4 }, true],
    [
      "a browser that does not report memory",
      { deviceMemory: undefined },
      true,
    ],
  ])("%s → %s", (_label, overrides, expected) => {
    expect(deviceAllows3D({ ...capable, ...overrides })).toBe(expected);
  });
});

// The gate keeps one-shot module state (the WebGL probe): load a fresh copy per test.
async function loadGate() {
  vi.resetModules();
  return import("./three-gate");
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    {} as RenderingContext,
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "connection");
  Reflect.deleteProperty(navigator, "deviceMemory");
});

// happy-dom has neither navigator.connection nor navigator.deviceMemory.
function stubNavigator(env: { saveData: boolean; deviceMemory: number }) {
  Object.defineProperty(navigator, "connection", {
    configurable: true,
    value: { saveData: env.saveData },
  });
  Object.defineProperty(navigator, "deviceMemory", {
    configurable: true,
    value: env.deviceMemory,
  });
}

describe("useDeviceAllows3D", () => {
  async function renderProbe() {
    const { useDeviceAllows3D } = await loadGate();
    function Probe() {
      return <span>{String(useDeviceAllows3D())}</span>;
    }
    act(() => root.render(<Probe />));
  }

  it("is false on the server", async () => {
    const { useDeviceAllows3D } = await loadGate();
    function Probe() {
      return <span>{String(useDeviceAllows3D())}</span>;
    }
    expect(renderToStaticMarkup(<Probe />)).toBe("<span>false</span>");
  });

  it("is true on a capable device, without probing WebGL", async () => {
    stubNavigator({ saveData: false, deviceMemory: 8 });
    await renderProbe();
    expect(container.textContent).toBe("true");
    expect(HTMLCanvasElement.prototype.getContext).not.toHaveBeenCalled();
  });

  it("is false with Save-Data or under 4 GB of memory", async () => {
    stubNavigator({ saveData: true, deviceMemory: 8 });
    await renderProbe();
    expect(container.textContent).toBe("false");

    stubNavigator({ saveData: false, deviceMemory: 2 });
    await renderProbe();
    expect(container.textContent).toBe("false");
  });
});

describe("supportsWebGL", () => {
  it("probes once per page load", async () => {
    const { supportsWebGL } = await loadGate();
    expect(supportsWebGL()).toBe(true);
    expect(supportsWebGL()).toBe(true);
    expect(HTMLCanvasElement.prototype.getContext).toHaveBeenCalledTimes(1);
  });
});
