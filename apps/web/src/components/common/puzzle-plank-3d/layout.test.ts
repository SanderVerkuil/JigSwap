import { BOX_SCALE, PX } from "@/components/marketing/plank-3d/box";
import { describe, expect, it } from "vitest";
import { GAP, layoutRow } from "./layout";

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
