import * as React from "react";

/**
 * Gate for the 3D shelf behind Play (components/shelf). three.js and rapier are ~1 MB gz plus a GPU
 * context, so they load only when a member asks for them, and only on a device that can afford
 * them: no Save-Data and at least 4 GB of memory where the browser reports it. WebGL is probed only
 * once asked, so a device that never asks allocates no GL context.
 */
const MIN_DEVICE_MEMORY_GB = 4;

export interface Device3DEnv {
  saveData: boolean;
  /** navigator.deviceMemory in GB; undefined where the browser hides it. */
  deviceMemory: number | undefined;
}

/** The device budget a 3D scene needs: no Save-Data and at least 4 GB of memory where reported. */
export function deviceAllows3D(env: Device3DEnv): boolean {
  if (env.saveData) return false;
  return (
    env.deviceMemory === undefined || env.deviceMemory >= MIN_DEVICE_MEMORY_GB
  );
}

// Probed once per page load: each probe would otherwise allocate a canvas + GL context.
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

function readEnv(): Device3DEnv {
  const nav = navigator as Navigator & {
    connection?: NetworkInformationLike;
    deviceMemory?: number;
  };
  return {
    saveData: nav.connection?.saveData === true,
    deviceMemory: nav.deviceMemory,
  };
}

const getDeviceSnapshot = () => deviceAllows3D(readEnv());

/**
 * True on a client whose device may run the 3D shelf a member asks for, at any viewport width.
 * False on the server and during hydration. It never probes WebGL: call supportsWebGL() only once
 * the member has asked.
 */
export function useDeviceAllows3D(): boolean {
  return React.useSyncExternalStore(noopSubscribe, getDeviceSnapshot, no);
}
