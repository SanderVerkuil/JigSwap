import { describe, expect, it } from "vitest";
import { BOX_SCALE, boxWorldSize, PX } from "./box";

describe("boxWorldSize", () => {
  it("derives width and height from a no-cover box", () => {
    const { w, h } = boxWorldSize({ width: 116, height: 144 }, 1);
    expect(w).toBeCloseTo(116 * PX * BOX_SCALE, 6);
    expect(h).toBeCloseTo(144 * PX * BOX_SCALE, 6);
  });
  it("uses width/1.4 for a cover box height", () => {
    const { h } = boxWorldSize({ width: 140, cover: "x.jpg" }, 1);
    expect(h).toBeCloseTo((140 / 1.4) * PX * BOX_SCALE, 6);
  });
  it("applies sizeScale and defaults width to 116", () => {
    const { w } = boxWorldSize({}, 2);
    expect(w).toBeCloseTo(116 * PX * BOX_SCALE * 2, 6);
  });
});
