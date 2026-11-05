import {
  BOX_SCALE,
  boxWorldSize,
  PX,
} from "@/components/marketing/plank-3d/box";
import { describe, expect, it } from "vitest";
import {
  CONTENT_HEADROOM,
  framedContentHeight,
  GAP,
  layoutRow,
  MIN_VIS_W,
  ROW_SIDE_MARGIN,
} from "./layout";

const w = (px: number) => px * PX * BOX_SCALE;

describe("layoutRow", () => {
  it("returns no slots and zero width for an empty list", () => {
    expect(layoutRow([])).toEqual({ slots: [], rowWidth: 0 });
  });

  it("centers a single box on x=0", () => {
    const { slots, rowWidth } = layoutRow([{ width: 116 }]);
    expect(slots).toHaveLength(1);
    expect(slots[0].x).toBeCloseTo(0, 6);
    expect(rowWidth).toBeCloseTo(w(116), 6);
  });

  it("defaults missing width to 116", () => {
    expect(layoutRow([{}])[0 as never]).toBeUndefined(); // guard: result is an object, not array
    const { rowWidth } = layoutRow([{}]);
    expect(rowWidth).toBeCloseTo(w(116), 6);
  });

  it("lays out two boxes left->right, centered, separated by GAP", () => {
    const { slots, rowWidth } = layoutRow([{ width: 100 }, { width: 100 }]);
    const wb = w(100);
    expect(rowWidth).toBeCloseTo(wb * 2 + GAP, 6);
    // centered: total span = 2*wb + GAP; first center at -(span/2)+wb/2
    expect(slots[0].x).toBeCloseTo(-(wb + GAP) / 2, 6);
    expect(slots[1].x).toBeCloseTo((wb + GAP) / 2, 6);
    expect(slots[1].x - slots[0].x).toBeCloseTo(wb + GAP, 6);
  });
});

describe("framedContentHeight", () => {
  // Height-only framing, as both scenes did before the row width counted.
  const heightOnly = (maxBoxH: number, aspect: number) =>
    Math.max(maxBoxH + CONTENT_HEADROOM, MIN_VIS_W / aspect);

  it("fits all five phone boxes on a near-square 358x300 phone canvas", () => {
    const boxes = Array.from({ length: 5 }, () => ({ width: 92 }));
    const { rowWidth } = layoutRow(boxes);
    const maxBoxH = boxWorldSize({ width: 92, height: 124 }).h;
    const aspect = 358 / 300;

    // The old framing showed less than the row, so the outer covers were cut.
    expect(heightOnly(maxBoxH, aspect) * aspect).toBeLessThan(rowWidth);

    const contentH = framedContentHeight({ maxBoxH, rowWidth, aspect });
    expect(contentH * aspect).toBeCloseTo(rowWidth + ROW_SIDE_MARGIN, 6);
    expect(contentH).toBeGreaterThanOrEqual(maxBoxH + CONTENT_HEADROOM);
  });

  it("leaves a wide 1100x360 desktop canvas height-bound and unchanged", () => {
    const boxes = [148, 130, 156, 126, 142].map((height) => ({ height }));
    const { rowWidth } = layoutRow(boxes);
    const maxBoxH = boxWorldSize({ height: 156 }).h;
    const aspect = 1100 / 360;

    const contentH = framedContentHeight({ maxBoxH, rowWidth, aspect });
    expect(contentH).toBeCloseTo(heightOnly(maxBoxH, aspect), 6);
    expect(contentH).toBeCloseTo(maxBoxH + CONTENT_HEADROOM, 6);
    expect(contentH * aspect).toBeGreaterThan(rowWidth + ROW_SIDE_MARGIN);
  });

  it("keeps the minimum visible width for a lone box on a narrow canvas", () => {
    const { rowWidth } = layoutRow([{ width: 92 }]);
    const maxBoxH = boxWorldSize({ width: 92 }).h;
    const aspect = 300 / 400;

    expect(framedContentHeight({ maxBoxH, rowWidth, aspect })).toBeCloseTo(
      MIN_VIS_W / aspect,
      6,
    );
  });
});
