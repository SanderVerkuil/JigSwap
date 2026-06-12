import type { PlankBox } from "@/components/marketing/plank";
import { CanvasTexture, SRGBColorSpace } from "three";

// Canvas pixels per CSS-plank pixel. The plank-3d front faces render at
// roughly 1.5-2x the CSS size on screen; 4x keeps text crisp at dpr 2.
export const ART_SCALE = 4;

export interface BoxArtSpec {
  /** Canvas dimensions in device pixels (already scaled by ART_SCALE). */
  width: number;
  height: number;
  mode: "cover" | "gradient";
  coverSrc?: string;
  /** Resolved hex colors — never raw var()/color-mix() strings. */
  c1: string;
  c2: string;
  series?: string;
  title?: string;
  pieceCount?: number;
}

export function buildBoxArtSpec(
  box: PlankBox,
  resolved: { c1: string; c2: string },
  heightPx: number,
): BoxArtSpec {
  const widthPx = box.width ?? 116;
  return {
    width: widthPx * ART_SCALE,
    height: heightPx * ART_SCALE,
    mode: box.cover ? "cover" : "gradient",
    coverSrc: box.cover,
    c1: resolved.c1,
    c2: resolved.c2,
    series: box.series,
    title: box.title,
    pieceCount: box.pieceCount,
  };
}

// ——— pure helpers (node-testable) ———

/**
 * Average an RGBA pixel buffer to a #rrggbb hex (alpha ignored). Pure.
 */
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

export interface CoverEdges {
  /** Stretched 1-edge-strip canvases for wrapping art around the box. */
  leftStrip: HTMLCanvasElement;
  rightStrip: HTMLCanvasElement;
  topStrip: HTMLCanvasElement;
  /** Average color of the image border — tint for bevels/back/bottom. */
  body: string;
}

/**
 * Extract cover-edge data from a loaded image.
 * - Draws the image onto a 64×64 probe canvas.
 * - Computes `body` from the 1-px border ring of the probe.
 * - Builds three strip canvases by drawing the outermost ~3% slice of each edge.
 */
export function extractCoverEdges(img: HTMLImageElement): CoverEdges {
  const PROBE = 64;
  const probe = document.createElement("canvas");
  probe.width = PROBE;
  probe.height = PROBE;
  const pCtx = probe.getContext("2d", { willReadFrequently: true })!;
  pCtx.drawImage(img, 0, 0, PROBE, PROBE);

  // Collect the 1-px border ring into one flat RGBA buffer.
  const top = pCtx.getImageData(0, 0, PROBE, 1).data;
  const bottom = pCtx.getImageData(0, PROBE - 1, PROBE, 1).data;
  const left = pCtx.getImageData(0, 0, 1, PROBE).data;
  const right = pCtx.getImageData(PROBE - 1, 0, 1, PROBE).data;
  const ring = new Uint8ClampedArray(
    top.length + bottom.length + left.length + right.length,
  );
  ring.set(top, 0);
  ring.set(bottom, top.length);
  ring.set(left, top.length + bottom.length);
  ring.set(right, top.length + bottom.length + left.length);
  const body = averagePixelColor(ring);

  const sw = img.naturalWidth;
  const sh = img.naturalHeight;
  // Outermost ~3% slice width/height in source pixels (min 1).
  const sliceW = Math.max(1, Math.round(sw * 0.03));
  const sliceH = Math.max(1, Math.round(sh * 0.03));

  // Left strip: draw the leftmost sliceW columns, stretched to 16×256.
  const leftStrip = document.createElement("canvas");
  leftStrip.width = 16;
  leftStrip.height = 256;
  leftStrip.getContext("2d")!.drawImage(img, 0, 0, sliceW, sh, 0, 0, 16, 256);

  // Right strip: draw the rightmost sliceW columns, stretched to 16×256.
  const rightStrip = document.createElement("canvas");
  rightStrip.width = 16;
  rightStrip.height = 256;
  rightStrip
    .getContext("2d")!
    .drawImage(img, sw - sliceW, 0, sliceW, sh, 0, 0, 16, 256);

  // Top strip: draw the topmost sliceH rows, stretched to 256×16.
  const topStrip = document.createElement("canvas");
  topStrip.width = 256;
  topStrip.height = 16;
  topStrip.getContext("2d")!.drawImage(img, 0, 0, sw, sliceH, 0, 0, 256, 16);

  return { leftStrip, rightStrip, topStrip, body };
}

// ——— impure, browser-only half ———

/** Font stack for box art; resolved from --font-mk-heading at the call site. */
export type ArtFonts = { heading: string };

export function drawBoxArt(
  spec: BoxArtSpec,
  canvas: HTMLCanvasElement,
  fonts: ArtFonts,
  coverImage?: HTMLImageElement,
): void {
  canvas.width = spec.width;
  canvas.height = spec.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const s = ART_SCALE;
  const w = spec.width;
  const h = spec.height;

  if (spec.mode === "cover" && coverImage) {
    // cover-fit the image
    if (!coverImage.naturalWidth || !coverImage.naturalHeight) return;
    const scale = Math.max(
      w / coverImage.naturalWidth,
      h / coverImage.naturalHeight,
    );
    const dw = coverImage.naturalWidth * scale;
    const dh = coverImage.naturalHeight * scale;
    ctx.drawImage(coverImage, (w - dw) / 2, (h - dh) / 2, dw, dh);
    return;
  }

  // gradient background, ~158deg like the CSS front face
  const grad = ctx.createLinearGradient(0, 0, w * 0.37, h);
  grad.addColorStop(0, spec.c1);
  grad.addColorStop(1, spec.c2);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // series eyebrow, top-left
  if (spec.series) {
    ctx.fillStyle = "rgb(255 255 255 / .92)";
    ctx.font = `700 ${9.5 * s}px ${fonts.heading}`;
    ctx.textBaseline = "top";
    ctx.fillText(spec.series.toUpperCase(), 8 * s, 6 * s);
    ctx.textBaseline = "alphabetic";
  }

  // piece-count badge, top-right white circle
  if (spec.pieceCount != null) {
    const r = 14 * s;
    const cx = w - 7 * s - r;
    const cy = (spec.series ? 24 : 7) * s + r;
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#1f1b2e";
    ctx.font = `700 ${11 * s}px ${fonts.heading}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(String(spec.pieceCount), cx, cy + 1 * s);
    ctx.fillStyle = "#7c7689";
    ctx.font = `${5.5 * s}px ${fonts.heading}`;
    ctx.fillText("PCS", cx, cy + 8 * s);
    ctx.textAlign = "start";
  }

  // white title strip along the bottom
  if (spec.title) {
    const stripH = 22 * s;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, h - stripH, w, stripH);
    ctx.fillStyle = "#1f1b2e";
    ctx.font = `700 ${11 * s}px ${fonts.heading}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(spec.title, w / 2, h - stripH / 2, w - 8 * s);
    ctx.textAlign = "start";
    ctx.textBaseline = "alphabetic";
  }
}

/**
 * Build a CanvasTexture for a box front. Draws synchronously (gradient
 * version), then upgrades to the cover image when it loads. Cover load
 * failure keeps the gradient fallback — mirrors the CSS plank's onError.
 */
export function createBoxArtTexture(
  spec: BoxArtSpec,
  fonts: ArtFonts,
  onCoverAspect?: (aspect: number) => void,
  onCoverEdges?: (edges: CoverEdges) => void,
): CanvasTexture {
  const canvas = document.createElement("canvas");
  drawBoxArt(spec, canvas, fonts);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;

  let disposed = false;
  let reallocating = false;
  texture.addEventListener("dispose", () => {
    if (!reallocating) disposed = true;
  });

  if (spec.mode === "cover" && spec.coverSrc) {
    const img = new Image();
    // Must be set before src to avoid CORS tainting the canvas on cross-origin
    // URLs (Convex storage). drawImage succeeds either way; only getImageData
    // (used in extractCoverEdges) throws on a tainted canvas.
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (disposed) return;
      const aspect = img.naturalWidth / img.naturalHeight;
      if (!Number.isFinite(aspect) || aspect <= 0) return;
      const corrected = { ...spec, height: Math.round(spec.width / aspect) };
      const resized =
        corrected.width !== canvas.width || corrected.height !== canvas.height;
      drawBoxArt(corrected, canvas, fonts, img);
      // The first GPU upload allocates immutable storage (texStorage2D) at the
      // pre-load guesstimate size; a resized canvas cannot go through the
      // texSubImage2D update path (silent GL_INVALID_VALUE when larger, so the
      // front face would stay stuck on the fallback art). Dispose the GL-side
      // texture so the next bind re-allocates at the corrected size — the
      // CanvasTexture itself stays usable. `reallocating` keeps this internal
      // dispose from being mistaken for the owner discarding the texture.
      if (resized) {
        reallocating = true;
        texture.dispose();
        reallocating = false;
      }
      texture.needsUpdate = true;
      onCoverAspect?.(aspect);
      // extractCoverEdges calls getImageData which throws a SecurityError when
      // the canvas is tainted (e.g. CORS headers missing on the server). Degrade
      // gracefully: keep the cover texture (drawImage already succeeded), skip
      // the edge-bleed effect.
      try {
        onCoverEdges?.(extractCoverEdges(img));
      } catch {
        // Tainted canvas or other SecurityError — skip edge bleed, keep cover.
      }
    };
    img.src = spec.coverSrc;
  }

  // brand font may not be loaded yet on first draw; redraw when ready
  if (spec.mode === "gradient") {
    document.fonts?.ready.then(() => {
      if (disposed) return;
      drawBoxArt(spec, canvas, fonts);
      texture.needsUpdate = true;
    });
  }

  return texture;
}
