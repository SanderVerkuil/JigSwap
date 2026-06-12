import { describe, expect, it } from "vitest";
import { ART_SCALE, averagePixelColor, buildBoxArtSpec } from "./box-art";

const colors = { c1: "#8b5cf6", c2: "#6d28d9" };

describe("averagePixelColor", () => {
  it("returns exact hex for a uniform buffer", () => {
    // 4 pixels, all (255, 128, 0, 255)
    const data = new Uint8ClampedArray(4 * 4);
    for (let i = 0; i < 4; i++) {
      data[i * 4] = 255;
      data[i * 4 + 1] = 128;
      data[i * 4 + 2] = 0;
      data[i * 4 + 3] = 255;
    }
    expect(averagePixelColor(data)).toBe("#ff8000");
  });

  it("averages mixed pixel colors correctly", () => {
    // 2 pixels: (100, 200, 0) and (200, 100, 0) → average (150, 150, 0)
    const data = new Uint8ClampedArray(2 * 4);
    data[0] = 100;
    data[1] = 200;
    data[2] = 0;
    data[3] = 255;
    data[4] = 200;
    data[5] = 100;
    data[6] = 0;
    data[7] = 255;
    expect(averagePixelColor(data)).toBe("#969600");
  });

  it("returns fallback for an empty buffer", () => {
    expect(averagePixelColor(new Uint8ClampedArray(0))).toBe("#888888");
  });
});

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
