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
): CanvasTexture {
  const canvas = document.createElement("canvas");
  drawBoxArt(spec, canvas, fonts);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;

  let disposed = false;
  texture.addEventListener("dispose", () => {
    disposed = true;
  });

  if (spec.mode === "cover" && spec.coverSrc) {
    const img = new Image();
    img.onload = () => {
      if (disposed) return;
      const aspect = img.naturalWidth / img.naturalHeight;
      if (!Number.isFinite(aspect) || aspect <= 0) return;
      const corrected = { ...spec, height: Math.round(spec.width / aspect) };
      drawBoxArt(corrected, canvas, fonts, img);
      texture.needsUpdate = true;
      onCoverAspect?.(aspect);
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
