import { describe, expect, it } from "vitest";
import { boxScale, shelfRowVars } from "./box-size";

describe("boxScale", () => {
  it("stands bigger puzzles in bigger boxes, never shrinking as the count grows", () => {
    const counts = [100, 300, 500, 750, 1000, 1500, 2000, 3000, 9000];
    const scales = counts.map(boxScale);
    for (let i = 1; i < scales.length; i++)
      expect(scales[i]).toBeGreaterThanOrEqual(scales[i - 1]);
  });

  it("keeps the home hero's proportions: 500 at 80% and 2,000 at 118% of a 1,000", () => {
    expect(boxScale(1000)).toBe(1);
    expect(boxScale(500)).toBeCloseTo(68 / 85, 2);
    expect(boxScale(2000)).toBeCloseTo(100 / 85, 2);
  });

  it("stands an unknown or nonsense count as a 1,000", () => {
    expect(boxScale(undefined)).toBe(1);
    expect(boxScale(0)).toBe(1);
    expect(boxScale(-5)).toBe(1);
  });
});

describe("shelfRowVars", () => {
  it("shares the row between the boxes, less the gaps, within the smallest and largest box", () => {
    expect(shelfRowVars([1, 0.8, 1.18])).toEqual({
      "--unit": "clamp(84px, calc((100cqw - 28px) / 2.98), 164px)",
      "--row-h": "calc(var(--unit) * 0.944)",
    });
  });

  it("is never as low as a 1,000-piece box is tall, and never divides by zero", () => {
    expect(shelfRowVars([0.72])).toEqual({
      "--unit": "clamp(84px, calc((100cqw - 0px) / 0.72), 164px)",
      "--row-h": "calc(var(--unit) * 0.8)",
    });
    expect(shelfRowVars([])["--unit" as never]).toContain("/ 1)");
  });
});
