"use node";

import { Jimp } from "jimp";
import {
  MAP_ATTRIBUTION,
  MapTilerError,
  metresPerPixel,
  pixelInView,
  staticMapUrl,
  TILE_SIZE,
  tilesForView,
  tileUrl,
  type MapTilerConfig,
  type MapView,
} from "./mapTiler";

// Server-side map rendering for location sharing (spec R.6): the view is composed from MapTiler
// raster tiles (any plan) or, behind MAPTILER_STATIC_API=true, fetched as one Static Maps image
// (paid plans). Then the marker and the "© MapTiler © OpenStreetMap contributors" attribution are
// drawn on, and the result is encoded as PNG. Called only from Convex actions; `fetchImpl` is
// injectable for tests.

type OkConfig = Extract<MapTilerConfig, { status: "ok" }>;
// What the drawing helpers touch: the RGBA bitmap.
type Image = {
  bitmap: { width: number; height: number; data: Uint8Array };
};

export interface MapMarker {
  readonly lat: number;
  readonly lng: number;
  /** `pin`: a point (exact). `area`: a shaded circle of `radiusMetres` (approximate). */
  readonly style: "pin" | "area";
  readonly radiusMetres?: number;
}

const FETCH_TIMEOUT_MS = 8_000;
const BACKGROUND = 0xe5e7ebff;
const PIN = { r: 225, g: 29, b: 72 };

const fetchImage = async (fetchImpl: typeof fetch, url: string) => {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    throw new MapTilerError("network");
  }
  if (!response.ok) throw new MapTilerError("http", response.status);
  try {
    return await Jimp.read(Buffer.from(await response.arrayBuffer()));
  } catch {
    throw new MapTilerError("invalid_response");
  }
};

// Blend one RGBA colour onto a pixel (alpha 0..1).
const blend = (
  image: Image,
  x: number,
  y: number,
  color: { r: number; g: number; b: number },
  alpha: number,
) => {
  const { width, height, data } = image.bitmap;
  if (x < 0 || y < 0 || x >= width || y >= height || alpha <= 0) return;
  const i = (Math.floor(y) * width + Math.floor(x)) * 4;
  data[i] = Math.round(data[i] * (1 - alpha) + color.r * alpha);
  data[i + 1] = Math.round(data[i + 1] * (1 - alpha) + color.g * alpha);
  data[i + 2] = Math.round(data[i + 2] * (1 - alpha) + color.b * alpha);
  data[i + 3] = 255;
};

// A teardrop pin whose tip sits on (x, y): a disc with a white ring and centre, and a triangle
// down to the tip.
const drawPin = (image: Image, x: number, y: number) => {
  const radius = 11;
  const cx = x;
  const cy = y - 20;
  for (let py = Math.floor(cy - radius - 2); py <= y; py += 1) {
    for (let px = Math.floor(cx - radius - 2); px <= cx + radius + 2; px += 1) {
      const d = Math.hypot(px - cx, py - cy);
      // The tail: a triangle from the disc's lower half to the tip.
      const t = (py - cy) / (y - cy);
      const inTail =
        py >= cy && py <= y && Math.abs(px - cx) <= radius * 0.75 * (1 - t);
      if (d <= 4) blend(image, px, py, { r: 255, g: 255, b: 255 }, 1);
      else if (d <= radius || inTail) blend(image, px, py, PIN, 1);
      else if (d <= radius + 2) {
        blend(image, px, py, { r: 255, g: 255, b: 255 }, 1);
      }
    }
  }
};

// A shaded circle of `radius` pixels around (x, y) with a solid edge: "somewhere around here".
const drawArea = (image: Image, x: number, y: number, radius: number) => {
  for (let py = Math.floor(y - radius - 2); py <= y + radius + 2; py += 1) {
    for (let px = Math.floor(x - radius - 2); px <= x + radius + 2; px += 1) {
      const d = Math.hypot(px - x, py - y);
      if (d <= radius - 2) blend(image, px, py, PIN, 0.18);
      else if (d <= radius + 1) blend(image, px, py, PIN, 0.85);
    }
  }
};

// A 7-row bitmap font for exactly the attribution's characters (no font files to bundle).
const GLYPHS: Record<string, string[]> = {
  "©": [
    "..###..",
    ".#...#.",
    "#..##.#",
    "#.#...#",
    "#..##.#",
    ".#...#.",
    "..###..",
  ],
  " ": ["...", "...", "...", "...", "...", "...", "..."],
  M: ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  a: [".....", ".....", ".###.", "....#", ".####", "#...#", ".####"],
  b: ["#....", "#....", "####.", "#...#", "#...#", "#...#", "####."],
  c: [".....", ".....", ".###.", "#....", "#....", "#...#", ".###."],
  e: [".....", ".....", ".###.", "#...#", "#####", "#....", ".###."],
  i: [".#.", "...", "##.", ".#.", ".#.", ".#.", "###"],
  l: ["##.", ".#.", ".#.", ".#.", ".#.", ".#.", "###"],
  n: [".....", ".....", "####.", "#...#", "#...#", "#...#", "#...#"],
  o: [".....", ".....", ".###.", "#...#", "#...#", "#...#", ".###."],
  p: [".....", ".....", "####.", "#...#", "####.", "#....", "#...."],
  r: [".....", ".....", "#.##.", "##..#", "#....", "#....", "#...."],
  s: [".....", ".....", ".####", "#....", ".###.", "....#", "####."],
  t: [".#...", ".#...", "####.", ".#...", ".#...", ".#..#", "..##."],
  u: [".....", ".....", "#...#", "#...#", "#...#", "#..##", ".##.#"],
};

const SCALE = 2;
const GAP = 1;

/** The attribution's rendered width in pixels (exported for tests). */
export const attributionWidth = (text = MAP_ATTRIBUTION): number =>
  [...text].reduce(
    (sum, ch) => sum + ((GLYPHS[ch]?.[0].length ?? 3) + GAP) * SCALE,
    0,
  ) -
  GAP * SCALE;

// The attribution, bottom-right, dark text on a translucent white strip.
const drawAttribution = (image: Image) => {
  const { width, height } = image.bitmap;
  const pad = 4;
  const textWidth = attributionWidth();
  const textHeight = 7 * SCALE;
  const boxLeft = Math.max(0, width - textWidth - pad * 2);
  const boxTop = height - textHeight - pad * 2;
  for (let y = boxTop; y < height; y += 1) {
    for (let x = boxLeft; x < width; x += 1) {
      blend(image, x, y, { r: 255, g: 255, b: 255 }, 0.8);
    }
  }
  let cursor = boxLeft + pad;
  for (const ch of MAP_ATTRIBUTION) {
    const glyph = GLYPHS[ch] ?? GLYPHS[" "];
    glyph.forEach((row, gy) => {
      [...row].forEach((cell, gx) => {
        if (cell !== "#") return;
        for (let dy = 0; dy < SCALE; dy += 1) {
          for (let dx = 0; dx < SCALE; dx += 1) {
            blend(
              image,
              cursor + gx * SCALE + dx,
              boxTop + pad + gy * SCALE + dy,
              { r: 31, g: 41, b: 55 },
              1,
            );
          }
        }
      });
    });
    cursor += (glyph[0].length + GAP) * SCALE;
  }
};

const composeTiles = async (
  config: OkConfig,
  view: MapView,
  fetchImpl: typeof fetch,
) => {
  const canvas = new Jimp({
    width: view.width,
    height: view.height,
    color: BACKGROUND,
  });
  // One fetch per distinct tile in this call (a view wrapping the antimeridian can repeat one).
  const cache = new Map<string, ReturnType<typeof fetchImage>>();
  for (const tile of tilesForView(view)) {
    const key = `${tile.z}/${tile.x}/${tile.y}`;
    let image = cache.get(key);
    if (!image) {
      image = fetchImage(fetchImpl, tileUrl(config, tile));
      cache.set(key, image);
    }
    const decoded = await image;
    if (
      decoded.bitmap.width !== TILE_SIZE ||
      decoded.bitmap.height !== TILE_SIZE
    ) {
      throw new MapTilerError("invalid_response");
    }
    canvas.composite(decoded, tile.left, tile.top);
  }
  return canvas;
};

const fetchStatic = async (
  config: OkConfig,
  view: MapView,
  fetchImpl: typeof fetch,
) => {
  const image = await fetchImage(fetchImpl, staticMapUrl(config, view));
  if (
    image.bitmap.width !== view.width ||
    image.bitmap.height !== view.height
  ) {
    image.resize({ w: view.width, h: view.height });
  }
  const canvas = new Jimp({
    width: view.width,
    height: view.height,
    color: BACKGROUND,
  });
  canvas.composite(image, 0, 0);
  return canvas;
};

/**
 * Render `view` with `marker` and the attribution into a PNG. Throws MapTilerError when the
 * provider fails (status code only, never the URL).
 */
export const renderMap = async (
  config: OkConfig,
  view: MapView,
  marker: MapMarker,
  fetchImpl: typeof fetch = fetch,
): Promise<Uint8Array> => {
  const image = config.staticApi
    ? await fetchStatic(config, view, fetchImpl)
    : await composeTiles(config, view, fetchImpl);
  const at = pixelInView(view, marker.lat, marker.lng);
  if (marker.style === "area") {
    const radius =
      (marker.radiusMetres ?? 800) / metresPerPixel(marker.lat, view.zoom);
    drawArea(image, at.x, at.y, Math.max(12, Math.round(radius)));
  } else {
    drawPin(image, Math.round(at.x), Math.round(at.y));
  }
  drawAttribution(image);
  return new Uint8Array(await image.getBuffer("image/png"));
};
