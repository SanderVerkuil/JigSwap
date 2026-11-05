// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deviceAllows3D, shouldLoad3D, type Load3DEnv } from "./three-gate";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const capable: Load3DEnv = {
  wideViewport: true,
  saveData: false,
  deviceMemory: 8,
  webgl: () => true,
};

describe("shouldLoad3D", () => {
  it.each<[string, Partial<Load3DEnv>, boolean]>([
    ["a capable desktop or tablet", {}, true],
    ["a phone-width viewport", { wideViewport: false }, false],
    ["Save-Data", { saveData: true }, false],
    ["2 GB of device memory", { deviceMemory: 2 }, false],
    ["exactly 4 GB of device memory", { deviceMemory: 4 }, true],
    [
      "a browser that does not report memory",
      { deviceMemory: undefined },
      true,
    ],
    ["no WebGL", { webgl: () => false }, false],
  ])("%s → %s", (_label, overrides, expected) => {
    expect(shouldLoad3D({ ...capable, ...overrides })).toBe(expected);
  });

  it("never probes WebGL when a cheaper check already says no", () => {
    let probed = false;
    const webgl = () => {
      probed = true;
      return true;
    };
    expect(shouldLoad3D({ ...capable, wideViewport: false, webgl })).toBe(
      false,
    );
    expect(shouldLoad3D({ ...capable, saveData: true, webgl })).toBe(false);
    expect(shouldLoad3D({ ...capable, deviceMemory: 1, webgl })).toBe(false);
    expect(probed).toBe(false);
  });
});

describe("deviceAllows3D", () => {
  it.each<[string, Partial<Load3DEnv>, boolean]>([
    ["a capable device", {}, true],
    ["a capable phone", { wideViewport: false }, true],
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

// The gate keeps one-shot module state (idle flag, WebGL probe): load a fresh
// copy per test.
async function loadGate() {
  vi.resetModules();
  return import("./three-gate");
}

function stubViewport(wide: boolean) {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        matches: wide,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
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
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useCanLoad3D", () => {
  it("is false on the server", async () => {
    const { useCanLoad3D } = await loadGate();
    function Probe() {
      return <span>{String(useCanLoad3D())}</span>;
    }
    expect(renderToStaticMarkup(<Probe />)).toBe("<span>false</span>");
  });

  it("waits for idle on a wide, capable client", async () => {
    stubViewport(true);
    const { useCanLoad3D } = await loadGate();
    function Probe() {
      return <span>{String(useCanLoad3D())}</span>;
    }
    act(() => root.render(<Probe />));
    expect(container.textContent).toBe("false");
    // happy-dom has no requestIdleCallback: the timeout fallback applies.
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(container.textContent).toBe("true");
  });

  it("stays false on a phone-width viewport after idle", async () => {
    stubViewport(false);
    const { useCanLoad3D } = await loadGate();
    function Probe() {
      return <span>{String(useCanLoad3D())}</span>;
    }
    act(() => root.render(<Probe />));
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(container.textContent).toBe("false");
    expect(HTMLCanvasElement.prototype.getContext).not.toHaveBeenCalled();
  });
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

afterEach(() => {
  Reflect.deleteProperty(navigator, "connection");
  Reflect.deleteProperty(navigator, "deviceMemory");
});

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

  it("is true on a capable phone, without probing WebGL", async () => {
    stubViewport(false);
    stubNavigator({ saveData: false, deviceMemory: 8 });
    await renderProbe();
    expect(container.textContent).toBe("true");
    expect(HTMLCanvasElement.prototype.getContext).not.toHaveBeenCalled();
  });

  it("is false with Save-Data or under 4 GB of memory", async () => {
    stubViewport(true);
    stubNavigator({ saveData: true, deviceMemory: 8 });
    await renderProbe();
    expect(container.textContent).toBe("false");

    stubNavigator({ saveData: false, deviceMemory: 2 });
    await renderProbe();
    expect(container.textContent).toBe("false");
  });
});
