// Pure geometry for pinch/pan/double-tap zoom on an image.
//
// Coordinate model: points are in CSS px relative to the CENTRE of the viewport (the zoom surface).
// The content (the image, rendered at its fitted 1x size and centred in the viewport) is drawn with
// `transform: translate(x, y) scale(scale)` and `transform-origin: center`, so a content point `q`
// (unscaled, relative to the centre) is displayed at `q * scale + (x, y)`.

export type Point = { x: number; y: number };
export type Size = { width: number; height: number };
export type ZoomState = { scale: number; x: number; y: number };

export const MIN_SCALE = 1;
export const MAX_SCALE = 4;
export const DOUBLE_TAP_SCALE = 2;

export const IDENTITY: ZoomState = { scale: 1, x: 0, y: 0 };

export function clampScale(
  scale: number,
  min = MIN_SCALE,
  max = MAX_SCALE,
): number {
  return Math.min(max, Math.max(min, scale));
}

/**
 * Zoom to `nextScale` (clamped) so the content point that was under `focal` ends up under
 * `nextFocal` (default: the same spot). Passing a moved `nextFocal` pans at the same time — that's
 * how a pinch follows its midpoint.
 */
export function zoomAtPoint(
  state: ZoomState,
  nextScale: number,
  focal: Point,
  nextFocal: Point = focal,
): ZoomState {
  const scale = clampScale(nextScale);
  // Content point under the focal point at the current transform.
  const qx = (focal.x - state.x) / state.scale;
  const qy = (focal.y - state.y) / state.scale;
  return { scale, x: nextFocal.x - qx * scale, y: nextFocal.y - qy * scale };
}

/**
 * Clamp the translation so the scaled content's edges never come inside the viewport. On an axis
 * where the scaled content is no larger than the viewport it stays centred (offset 0).
 */
export function clampPan(
  state: ZoomState,
  content: Size,
  viewport: Size,
): ZoomState {
  const maxX = Math.max(0, (content.width * state.scale - viewport.width) / 2);
  const maxY = Math.max(
    0,
    (content.height * state.scale - viewport.height) / 2,
  );
  return {
    scale: state.scale,
    // `+ 0` normalises -0 to 0 so callers can compare against IDENTITY.
    x: Math.min(maxX, Math.max(-maxX, state.x)) + 0,
    y: Math.min(maxY, Math.max(-maxY, state.y)) + 0,
  };
}

/** Double-tap: from fit, zoom to 2x anchored at the tap point; when zoomed, return to fit. */
export function toggleDoubleTap(
  state: ZoomState,
  point: Point,
  content: Size,
  viewport: Size,
): ZoomState {
  if (state.scale > MIN_SCALE) return IDENTITY;
  return clampPan(
    zoomAtPoint(state, DOUBLE_TAP_SCALE, point),
    content,
    viewport,
  );
}

/** Button zoom: step the scale by `delta` around the viewport centre, clamped. */
export function stepZoom(
  state: ZoomState,
  delta: number,
  content: Size,
  viewport: Size,
): ZoomState {
  return clampPan(
    zoomAtPoint(state, state.scale + delta, { x: 0, y: 0 }),
    content,
    viewport,
  );
}
