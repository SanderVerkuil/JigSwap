import { describe, expect, it } from "vitest";
import { easeOut, eyeAt, PX, stageFrustum, toWorld } from "./play-layout";

const stage = { width: 800, height: 200 };

// Where a world point lands on the stage, in CSS px, through the frustum stageFrustum gives (the
// projection three.js builds from it with makePerspective).
function project(
  eye: { x: number; y: number; z: number },
  point: [number, number, number],
) {
  const near = 0.1;
  const f = stageFrustum(stage, eye, near);
  // Onto the near plane, then into the frustum's [-1, 1] range.
  const dz = eye.z - point[2];
  const nx = ((point[0] - eye.x) * near) / dz;
  const ny = ((point[1] - eye.y) * near) / dz;
  const ndcX = (2 * nx - (f.right + f.left)) / (f.right - f.left);
  const ndcY = (2 * ny - (f.top + f.bottom)) / (f.top - f.bottom);
  return [((ndcX + 1) / 2) * stage.width, ((1 - ndcY) / 2) * stage.height];
}

describe("toWorld", () => {
  it("puts the stage's centre at the origin, y up, a hundred px to a unit", () => {
    expect(toWorld(stage, 400, 100)).toEqual([0, 0]);
    expect(toWorld(stage, 500, 50)).toEqual([100 * PX, 50 * PX]);
    expect(toWorld(stage, 0, 200)).toEqual([-4, -1]);
  });
});

describe("stageFrustum", () => {
  it("lands a box front on the pixels the flat row drew it on, wherever the eye is", () => {
    const corner = [...toWorld(stage, 120, 40), 0] as [number, number, number];
    for (const depth of [0, 0.3, 1]) {
      const [x, y] = project(eyeAt(stage, depth), corner);
      expect(x).toBeCloseTo(120, 6);
      expect(y).toBeCloseTo(40, 6);
    }
  });

  it("shows a box's depth only once the eye comes in", () => {
    // A back corner, a quarter unit behind the front, far left on the stage.
    const back = [...toWorld(stage, 20, 150), -0.25] as [
      number,
      number,
      number,
    ];
    const [flatX] = project(eyeAt(stage, 0), back);
    const [deepX] = project(eyeAt(stage, 1), back);
    expect(Math.abs(flatX - 20)).toBeLessThan(0.5);
    expect(deepX - 20).toBeGreaterThan(3);
  });
});

describe("eyeAt", () => {
  it("starts nearly flat and ends above the stage, looking down onto the box tops", () => {
    expect(eyeAt(stage, 0).z).toBeGreaterThan(300);
    expect(eyeAt(stage, 0).y).toBe(0);
    const near = eyeAt(stage, 1);
    expect(near.z).toBeLessThan(20);
    expect(near.y).toBeGreaterThan((stage.height / 2) * PX);
  });
});

describe("easeOut", () => {
  it("runs from 0 to 1, fast at first, and clamps outside", () => {
    expect(easeOut(0)).toBe(0);
    expect(easeOut(1)).toBe(1);
    expect(easeOut(0.5)).toBeGreaterThan(0.5);
    expect(easeOut(-1)).toBe(0);
    expect(easeOut(2)).toBe(1);
  });
});
