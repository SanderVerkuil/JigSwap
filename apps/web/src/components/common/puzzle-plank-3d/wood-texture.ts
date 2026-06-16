import * as React from "react";
import * as THREE from "three";

// ——— Procedural wood-grain texture ———
// The shelf board used to be a flat single colour. This generates a warm,
// semi-realistic wood-grain CanvasTexture from the theme's shelf colour so the
// plank reads as a real wooden board — mirroring how box-art textures are
// generated on a canvas (no binary asset, no licensing concerns). The grain
// runs along the board's length (the texture's U axis), which is correct for
// both the top face and the front edge of the box geometry.

const TEX_W = 1024;
const TEX_H = 512;
// Grain lines across the board's narrow axis (depth on the top face). Tuned to
// read as a plank without looking striped.
const GRAINS = 11;

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Cheap deterministic value noise (sin-hash). Good enough for grain warp and
// tonal variation; no external dependency.
function hash(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function valueNoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const tl = hash(xi, yi);
  const tr = hash(xi + 1, yi);
  const bl = hash(xi, yi + 1);
  const br = hash(xi + 1, yi + 1);
  const u = smooth(xf);
  const v = smooth(yf);
  return (tl + (tr - tl) * u) * (1 - v) + (bl + (br - bl) * u) * v;
}

function fbm(x: number, y: number): number {
  let value = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < 4; i++) {
    value += amp * valueNoise(x * freq, y * freq);
    freq *= 2;
    amp *= 0.5;
  }
  return value;
}

/** Build a wood-grain CanvasTexture tinted from `baseColor` (e.g. "#c98f4d"). */
export function createWoodTexture(baseColor: string): THREE.CanvasTexture {
  const [br, bg, bb] = hexToRgb(baseColor);
  const canvas = document.createElement("canvas");
  canvas.width = TEX_W;
  canvas.height = TEX_H;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(TEX_W, TEX_H);
  const data = img.data;

  for (let y = 0; y < TEX_H; y++) {
    const ny = y / TEX_H;
    for (let x = 0; x < TEX_W; x++) {
      const nx = x / TEX_W;

      // Warp the grain lines so they wobble gently along the board length
      // rather than running perfectly straight.
      const warp = fbm(nx * 4, ny * 2) - 0.5;
      const g = (ny + warp * 0.06) * GRAINS;
      // Thin dark lines at each integer grain boundary.
      const line = Math.pow(1 - Math.abs(Math.sin(g * Math.PI)), 3);
      // Fine high-frequency streaks running with the grain.
      const streak = fbm(nx * 3, ny * 44) - 0.5;
      // Broad low-frequency tonal drift so the board isn't uniform.
      const tone = fbm(nx * 1.5, ny * 1.5) - 0.5;

      const brightness =
        1 - line * 0.3 - Math.max(0, streak) * 0.16 + tone * 0.1;

      const i = (y * TEX_W + x) * 4;
      data[i] = Math.max(0, Math.min(255, br * brightness));
      data[i + 1] = Math.max(0, Math.min(255, bg * brightness));
      data[i + 2] = Math.max(0, Math.min(255, bb * brightness));
      data[i + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Memoize one wood texture per shelf colour and dispose it on unmount / change.
 * Each <Canvas> tree calls this independently, so each gets its own GPU texture.
 */
export function useWoodTexture(baseColor: string): THREE.CanvasTexture {
  const texture = React.useMemo(
    () => createWoodTexture(baseColor),
    [baseColor],
  );
  React.useEffect(() => () => texture.dispose(), [texture]);
  return texture;
}
