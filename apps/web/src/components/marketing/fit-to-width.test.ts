import { describe, expect, it } from "vitest";
import { fitScale } from "./fit-to-width";

describe("fitScale", () => {
  it("scales down when the child is wider than the container", () => {
    expect(fitScale(360, 500)).toBeCloseTo(0.72, 5);
  });

  it("never scales up past 1 when the container is wider", () => {
    expect(fitScale(800, 500)).toBe(1);
  });

  it("returns 1 when widths are equal", () => {
    expect(fitScale(500, 500)).toBe(1);
  });

  it("guards against a zero / unmeasured container width", () => {
    expect(fitScale(0, 500)).toBe(1);
  });

  it("guards against a zero / unmeasured natural width", () => {
    expect(fitScale(360, 0)).toBe(1);
  });
});
