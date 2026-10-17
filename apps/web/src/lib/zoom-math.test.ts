import { describe, expect, it } from "vitest";
import {
  clampPan,
  clampScale,
  IDENTITY,
  stepZoom,
  toggleDoubleTap,
  zoomAtPoint,
  type Point,
  type ZoomState,
} from "./zoom-math";

// Where a content point (unscaled, relative to the centre) is displayed under a transform.
const project = (s: ZoomState, q: Point): Point => ({
  x: q.x * s.scale + s.x,
  y: q.y * s.scale + s.y,
});
// The content point displayed at a screen point.
const unproject = (s: ZoomState, p: Point): Point => ({
  x: (p.x - s.x) / s.scale,
  y: (p.y - s.y) / s.scale,
});

const viewport = { width: 400, height: 800 };
const content = { width: 400, height: 300 }; // landscape photo letterboxed in a portrait viewport

describe("clampScale", () => {
  it("keeps values within 1x–4x", () => {
    expect(clampScale(0.3)).toBe(1);
    expect(clampScale(1)).toBe(1);
    expect(clampScale(2.5)).toBe(2.5);
    expect(clampScale(4)).toBe(4);
    expect(clampScale(9)).toBe(4);
  });
});

describe("zoomAtPoint", () => {
  it("keeps the content point under the focal point fixed", () => {
    const focal = { x: 120, y: -60 };
    for (const start of [
      IDENTITY,
      { scale: 2, x: 30, y: -10 },
      { scale: 3.2, x: -100, y: 40 },
    ]) {
      const q = unproject(start, focal);
      for (const next of [1.5, 2, 3.7]) {
        const after = zoomAtPoint(start, next, focal);
        const p = project(after, q);
        expect(p.x).toBeCloseTo(focal.x);
        expect(p.y).toBeCloseTo(focal.y);
      }
    }
  });

  it("moves the anchored point to nextFocal (pinch midpoint pans)", () => {
    const start = { scale: 1.5, x: 10, y: 5 };
    const focal = { x: 50, y: 50 };
    const q = unproject(start, focal);
    const after = zoomAtPoint(start, 2.5, focal, { x: 80, y: 20 });
    const p = project(after, q);
    expect(after.scale).toBe(2.5);
    expect(p.x).toBeCloseTo(80);
    expect(p.y).toBeCloseTo(20);
  });

  it("clamps the target scale", () => {
    expect(zoomAtPoint(IDENTITY, 10, { x: 0, y: 0 }).scale).toBe(4);
    expect(zoomAtPoint({ scale: 2, x: 0, y: 0 }, 0.2, { x: 0, y: 0 })).toEqual({
      scale: 1,
      x: 0,
      y: 0,
    });
  });
});

describe("clampPan", () => {
  it("centres the content at 1x", () => {
    expect(clampPan({ scale: 1, x: 50, y: -70 }, content, viewport)).toEqual(
      IDENTITY,
    );
  });

  it("allows panning only up to the scaled content edges", () => {
    // 2x: 800x600 content in a 400x800 viewport → x within ±200, y still centred.
    expect(clampPan({ scale: 2, x: 999, y: 999 }, content, viewport)).toEqual({
      scale: 2,
      x: 200,
      y: 0,
    });
    // 4x: 1600x1200 → x within ±600, y within ±200.
    expect(clampPan({ scale: 4, x: -999, y: -999 }, content, viewport)).toEqual(
      { scale: 4, x: -600, y: -200 },
    );
  });

  it("leaves in-bounds offsets untouched", () => {
    const s = { scale: 3, x: 120, y: -30 };
    expect(clampPan(s, content, viewport)).toEqual(s);
  });

  it("keeps the content's edges outside the viewport after clamping", () => {
    for (const scale of [1.25, 2, 3, 4]) {
      const s = clampPan({ scale, x: 5000, y: -5000 }, content, viewport);
      const halfW = (content.width * scale) / 2;
      const halfH = (content.height * scale) / 2;
      if (halfW >= viewport.width / 2) {
        expect(s.x - halfW).toBeLessThanOrEqual(-viewport.width / 2 + 1e-9);
        expect(s.x + halfW).toBeGreaterThanOrEqual(viewport.width / 2 - 1e-9);
      } else {
        expect(s.x).toBe(0);
      }
      if (halfH >= viewport.height / 2) {
        expect(s.y - halfH).toBeLessThanOrEqual(-viewport.height / 2 + 1e-9);
        expect(s.y + halfH).toBeGreaterThanOrEqual(viewport.height / 2 - 1e-9);
      } else {
        expect(s.y).toBe(0);
      }
    }
  });
});

describe("toggleDoubleTap", () => {
  it("zooms to 2x anchored at the tap point from fit", () => {
    const tap = { x: 60, y: 40 };
    const q = unproject(IDENTITY, tap);
    const after = toggleDoubleTap(IDENTITY, tap, content, viewport);
    expect(after.scale).toBe(2);
    const p = project(after, q);
    // x is within pan bounds so the point stays put; y is centred (2x content height < viewport).
    expect(p.x).toBeCloseTo(tap.x);
    expect(after.y).toBe(0);
  });

  it("clamps the anchored zoom near an edge", () => {
    // Portrait photo 400x600: at 2x it's 800x1200, so pan bounds are x ±200, y ±200. A tap near
    // the bottom would want y = -290; it's held at the edge instead.
    const after = toggleDoubleTap(
      IDENTITY,
      { x: 50, y: 290 },
      { width: 400, height: 600 },
      viewport,
    );
    expect(after).toEqual({ scale: 2, x: -50, y: -200 });
  });

  it("returns to fit when zoomed", () => {
    expect(
      toggleDoubleTap(
        { scale: 3, x: 40, y: 10 },
        { x: 0, y: 0 },
        content,
        viewport,
      ),
    ).toEqual(IDENTITY);
  });
});

describe("stepZoom", () => {
  it("steps around the centre and stays within bounds", () => {
    expect(stepZoom(IDENTITY, 1, content, viewport)).toEqual({
      scale: 2,
      x: 0,
      y: 0,
    });
    expect(stepZoom({ scale: 4, x: 0, y: 0 }, 1, content, viewport).scale).toBe(
      4,
    );
    // Zooming out re-clamps an offset that would now expose the viewport.
    expect(stepZoom({ scale: 3, x: 400, y: 0 }, -1, content, viewport)).toEqual(
      { scale: 2, x: 200, y: 0 },
    );
    expect(stepZoom({ scale: 2, x: 200, y: 0 }, -1, content, viewport)).toEqual(
      IDENTITY,
    );
  });
});
