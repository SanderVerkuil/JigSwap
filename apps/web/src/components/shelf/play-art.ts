import {
  CanvasTexture,
  LinearFilter,
  SRGBColorSpace,
  type Texture,
} from "three";
import type { PlayBox, PlayLayout } from "./play-layout";

// The pictures the 3D boxes wear: each cover on the front, its outermost slices wrapped round the
// sides and top like printed box art, and a painted lid lettered like the flat one for a box
// without a cover. Loaded before the scene's first frame, so that frame matches the flat row.

/** Average an RGBA pixel buffer to a #rrggbb hex (alpha ignored). Pure. */
export function averagePixelColor(data: Uint8ClampedArray): string {
  let r = 0,
    g = 0,
    b = 0;
  const n = data.length / 4;
  if (n === 0) return "#888888";
  for (let i = 0; i < data.length; i += 4) {
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
  }
  return `#${[r, g, b]
    .map((v) =>
      Math.round(v / n)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

interface CoverEdges {
  left: HTMLCanvasElement;
  right: HTMLCanvasElement;
  top: HTMLCanvasElement;
  /** Average colour of the cover's border: the box's bottom and back. */
  body: string;
}

// The outermost ~3% of each edge, stretched onto a strip, and the border's average colour.
function extractCoverEdges(img: HTMLImageElement): CoverEdges {
  const PROBE = 64;
  const probe = document.createElement("canvas");
  probe.width = PROBE;
  probe.height = PROBE;
  const ctx = probe.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, PROBE, PROBE);
  const parts = [
    ctx.getImageData(0, 0, PROBE, 1).data,
    ctx.getImageData(0, PROBE - 1, PROBE, 1).data,
    ctx.getImageData(0, 0, 1, PROBE).data,
    ctx.getImageData(PROBE - 1, 0, 1, PROBE).data,
  ];
  const ring = new Uint8ClampedArray(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    ring.set(part, offset);
    offset += part.length;
  }

  const sw = img.naturalWidth;
  const sh = img.naturalHeight;
  const sliceW = Math.max(1, Math.round(sw * 0.03));
  const sliceH = Math.max(1, Math.round(sh * 0.03));
  const strip = (
    w: number,
    h: number,
    sx: number,
    sy: number,
    sWidth: number,
    sHeight: number,
  ) => {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas
      .getContext("2d")!
      .drawImage(img, sx, sy, sWidth, sHeight, 0, 0, w, h);
    return canvas;
  };
  return {
    left: strip(16, 256, 0, 0, sliceW, sh),
    right: strip(16, 256, sw - sliceW, 0, sliceW, sh),
    top: strip(256, 16, 0, 0, sw, sliceH),
    body: averagePixelColor(ring),
  };
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    // Before src, so the texture upload and the edge reads aren't refused (Convex storage and the
    // catalogue's art send CORS headers).
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => resolve(img.naturalWidth > 0 ? img : null);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// Wraps text into at most `maxLines` lines no wider than `width`, ending a cut line with "…".
function wrap(
  ctx: CanvasRenderingContext2D,
  text: string,
  width: number,
  maxLines: number,
): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= width || !line) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = `${kept[maxLines - 1]}…`;
  return kept;
}

// The painted lid, drawn the way box-face.tsx's PaintedLid lays it out: brand at the top, the title
// under it in the display face, the piece count bottom right, all in white on the lid's colour.
function drawLid(box: PlayBox, fonts: PlayLayout["fonts"]): HTMLCanvasElement {
  const SCALE = 3;
  const w = Math.max(1, Math.round(box.w));
  const h = Math.max(1, Math.round(box.h));
  const canvas = document.createElement("canvas");
  canvas.width = w * SCALE;
  canvas.height = h * SCALE;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = box.lid.color;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "top";
  const pad = 0.07 * w;
  const small = Math.max(10, 0.08 * w);
  const big = Math.max(12, 0.12 * w);
  let y = pad;
  if (box.lid.brand) {
    ctx.font = `400 ${small}px ${fonts.text}`;
    ctx.fillText(box.lid.brand, pad, y, w - 2 * pad);
    y += small * 1.25 + 4;
  }
  ctx.font = `400 ${big}px ${fonts.heading}`;
  for (const line of wrap(ctx, box.lid.title, w - 2 * pad, 3)) {
    ctx.fillText(line, pad, y, w - 2 * pad);
    y += big * 1.08;
  }
  if (box.lid.pieces) {
    ctx.font = `400 ${small}px ${fonts.text}`;
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText(box.lid.pieces, w - pad, h - pad);
  }
  return canvas;
}

export interface BoxArt {
  front: Texture;
  /** The cover's edges wrapped round the box; a lid's sides are its colour. */
  sides?: { left: Texture; right: Texture; top: Texture };
  /** The colour of the faces without a picture. */
  body: string;
  dispose: () => void;
}

// The cover as the flat row shows it: shrunk by the browser to the box's size on screen (at the
// device's pixel ratio), the way the <img> was, so the first 3D frame has the row's own pixels.
function atScreenSize(img: HTMLImageElement, box: PlayBox): HTMLCanvasElement {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(box.w * ratio));
  canvas.height = Math.max(1, Math.round(box.h * ratio));
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

const srgb = <T extends Texture>(texture: T): T => {
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
};

async function artFor(
  box: PlayBox,
  fonts: PlayLayout["fonts"],
): Promise<BoxArt> {
  const img = box.cover ? await loadImage(box.cover) : null;
  if (img) {
    const front = srgb(new CanvasTexture(atScreenSize(img, box)));
    // Drawn 1:1, so no mipmaps: the GPU's linear-light averaging would brighten a busy cover.
    front.generateMipmaps = false;
    front.minFilter = LinearFilter;
    const edges = extractCoverEdges(img);
    const sides = {
      left: srgb(new CanvasTexture(edges.left)),
      right: srgb(new CanvasTexture(edges.right)),
      top: srgb(new CanvasTexture(edges.top)),
    };
    return {
      front,
      sides,
      body: edges.body,
      dispose: () =>
        [front, sides.left, sides.right, sides.top].forEach((t) => t.dispose()),
    };
  }
  // The lid's lettering needs the page's fonts; they are long loaded by the time Play is pressed.
  await document.fonts?.ready;
  const front = srgb(new CanvasTexture(drawLid(box, fonts)));
  return { front, body: box.lid.color, dispose: () => front.dispose() };
}

const loads = new WeakMap<PlayLayout, Promise<BoxArt[]>>();

/** Every box's art for one measured layout, loaded once (React's `use` reads the same promise). */
export function loadArt(layout: PlayLayout): Promise<BoxArt[]> {
  let load = loads.get(layout);
  if (!load) {
    load = Promise.all(layout.boxes.map((box) => artFor(box, layout.fonts)));
    loads.set(layout, load);
  }
  return load;
}
