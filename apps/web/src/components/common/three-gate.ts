import * as React from "react";

/**
 * Gate for the decorative three.js scenes (marketing hero, dashboard and
 * profile shelves). three.js is ~245 KB gz plus a GPU context, so it loads
 * only once the page is idle, on a viewport of at least 768 px, without
 * Save-Data and with at least 4 GB of memory where the browser reports it.
 * Everywhere else the CSS plank stays. A scene loaded on the member's request
 * (the profile shelf's physics) needs the same device budget at any viewport
 * width (deviceAllows3D) and probes WebGL only once asked.
 */
const WIDE_VIEWPORT = "(min-width: 768px)";
const MIN_DEVICE_MEMORY_GB = 4;
// requestIdleCallback deadline, and the delay used where it doesn't exist
// (Safari).
const IDLE_TIMEOUT_MS = 2000;
const IDLE_FALLBACK_MS = 500;

export interface Load3DEnv {
  wideViewport: boolean;
  saveData: boolean;
  /** navigator.deviceMemory in GB; undefined where the browser hides it. */
  deviceMemory: number | undefined;
  /** Called last: a probe allocates a canvas and a GL context. */
  webgl: () => boolean;
}

/**
 * The device budget every 3D scene needs, whether it loads on idle or on
 * request: no Save-Data and at least 4 GB of memory where reported.
 */
export function deviceAllows3D(
  env: Pick<Load3DEnv, "saveData" | "deviceMemory">,
): boolean {
  if (env.saveData) return false;
  return (
    env.deviceMemory === undefined || env.deviceMemory >= MIN_DEVICE_MEMORY_GB
  );
}

export function shouldLoad3D(env: Load3DEnv): boolean {
  if (!env.wideViewport || !deviceAllows3D(env)) return false;
  return env.webgl();
}

// Probed once per page load: useSyncExternalStore calls the snapshot on every
// render, and each probe would otherwise allocate a canvas + GL context.
let webGLSupport: boolean | undefined;
export function supportsWebGL(): boolean {
  if (webGLSupport !== undefined) return webGLSupport;
  try {
    const canvas = document.createElement("canvas");
    webGLSupport = !!(
      canvas.getContext("webgl2") || canvas.getContext("webgl")
    );
  } catch {
    webGLSupport = false;
  }
  return webGLSupport;
}

const noopSubscribe = () => () => {};
const no = () => false;

interface NetworkInformationLike {
  saveData?: boolean;
}

function readEnv(): Load3DEnv {
  const nav = navigator as Navigator & {
    connection?: NetworkInformationLike;
    deviceMemory?: number;
  };
  return {
    wideViewport: window.matchMedia(WIDE_VIEWPORT).matches,
    saveData: nav.connection?.saveData === true,
    deviceMemory: nav.deviceMemory,
    webgl: supportsWebGL,
  };
}

// One-shot "the page has gone idle once" flag, shared by every 3D widget: the
// first subscriber schedules it, later mounts (client navigations) see it set.
let idle = false;
let idleScheduled = false;
const idleListeners = new Set<() => void>();

function scheduleIdle() {
  if (idle || idleScheduled) return;
  idleScheduled = true;
  const fire = () => {
    idle = true;
    idleListeners.forEach((fn) => fn());
  };
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(fire, { timeout: IDLE_TIMEOUT_MS });
  } else {
    window.setTimeout(fire, IDLE_FALLBACK_MS);
  }
}

function subscribe(onChange: () => void) {
  const mq = window.matchMedia(WIDE_VIEWPORT);
  mq.addEventListener("change", onChange);
  idleListeners.add(onChange);
  scheduleIdle();
  return () => {
    mq.removeEventListener("change", onChange);
    idleListeners.delete(onChange);
  };
}

const getSnapshot = () => idle && shouldLoad3D(readEnv());
const getServerSnapshot = () => false;

/**
 * True once a 3D scene may load. False on the server and during hydration, so
 * the CSS plank is always the first paint.
 */
export function useCanLoad3D(): boolean {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

const getDeviceSnapshot = () => deviceAllows3D(readEnv());

/**
 * True on a client whose device may run a 3D scene the member asks for (the
 * shelf physics behind Play), at any viewport width. False on the server and
 * during hydration. It never probes WebGL: call supportsWebGL() only once the
 * member has asked, so a device that never asks allocates no GL context.
 */
export function useDeviceAllows3D(): boolean {
  return React.useSyncExternalStore(noopSubscribe, getDeviceSnapshot, no);
}
