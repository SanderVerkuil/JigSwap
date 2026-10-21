import { describe, expect, it } from "vitest";
import { sameBox, shouldSlide } from "./active-row-indicator";

const viewport = { top: 100, bottom: 500 };

describe("shouldSlide", () => {
  it("places without sliding on first paint", () => {
    expect(shouldSlide(null, viewport)).toBe(false);
  });

  it("slides from a row inside the list's viewport", () => {
    expect(shouldSlide({ top: 200, bottom: 268 }, viewport)).toBe(true);
  });

  it("slides from a row partly in view", () => {
    expect(shouldSlide({ top: 60, bottom: 128 }, viewport)).toBe(true);
    expect(shouldSlide({ top: 470, bottom: 538 }, viewport)).toBe(true);
  });

  it("places without sliding when the previous row was scrolled out of view", () => {
    expect(shouldSlide({ top: 0, bottom: 68 }, viewport)).toBe(false);
    expect(shouldSlide({ top: 32, bottom: 100 }, viewport)).toBe(false);
    expect(shouldSlide({ top: 500, bottom: 568 }, viewport)).toBe(false);
  });
});

describe("sameBox", () => {
  const box = { top: 8, left: 8, width: 324, height: 68 };

  it("matches equal boxes and two empties", () => {
    expect(sameBox(box, { ...box })).toBe(true);
    expect(sameBox(null, null)).toBe(true);
  });

  it("tells moved, resized and missing boxes apart", () => {
    expect(sameBox(box, { ...box, top: 78 })).toBe(false);
    expect(sameBox(box, { ...box, width: 344 })).toBe(false);
    expect(sameBox(box, null)).toBe(false);
  });
});
