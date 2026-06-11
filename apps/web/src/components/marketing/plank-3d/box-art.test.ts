import { describe, expect, it } from "vitest";
import { ART_SCALE, buildBoxArtSpec } from "./box-art";

const colors = { c1: "#8b5cf6", c2: "#6d28d9" };

describe("buildBoxArtSpec", () => {
  it("uses cover mode when a cover is present", () => {
    const spec = buildBoxArtSpec(
      { cover: "/img/sand.jpg", title: "Zand", width: 134 },
      colors,
      96,
    );
    expect(spec.mode).toBe("cover");
    expect(spec.coverSrc).toBe("/img/sand.jpg");
  });

  it("uses gradient mode without a cover, carrying text content", () => {
    const spec = buildBoxArtSpec(
      { series: "Natuur", title: "Boslicht", pieceCount: 1000, width: 100 },
      colors,
      144,
    );
    expect(spec.mode).toBe("gradient");
    expect(spec.series).toBe("Natuur");
    expect(spec.title).toBe("Boslicht");
    expect(spec.pieceCount).toBe(1000);
    expect(spec.c1).toBe("#8b5cf6");
    expect(spec.c2).toBe("#6d28d9");
  });

  it("scales canvas dimensions by ART_SCALE for crispness", () => {
    const spec = buildBoxArtSpec({ width: 100 }, colors, 144);
    expect(spec.width).toBe(100 * ART_SCALE);
    expect(spec.height).toBe(144 * ART_SCALE);
  });

  it("falls back to a 116px width like the CSS plank when width is unset", () => {
    const spec = buildBoxArtSpec({}, colors, 144);
    expect(spec.width).toBe(116 * ART_SCALE);
  });
});
