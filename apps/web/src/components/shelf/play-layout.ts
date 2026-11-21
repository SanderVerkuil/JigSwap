// Where a shelf's boxes and ledge stand, measured off the flat row when Play is pressed, and the
// geometry that lets the 3D scene's first frame match that row to the pixel. Kept apart from the
// scene so it stays testable without three.js and never pulls it into the page bundle.

/** A box as the flat row drew it, in CSS px from the stage's top-left. */
export interface PlayBox {
  x: number;
  y: number;
  w: number;
  h: number;
  /** The cover the row shows; without it (or when it fails) the box is a painted lid. */
  cover?: string;
  lid: { color: string; title: string; brand?: string; pieces?: string };
}

export interface PlayLayout {
  /** The stage (the area the canvas covers), CSS px. */
  width: number;
  height: number;
  boxes: PlayBox[];
  ledge: { x: number; y: number; w: number; h: number };
  /** The ledge's colour as the page computed it (the night plank after dark). */
  plank: string;
  /** Fonts the painted lids are lettered in. */
  fonts: { heading: string; text: string };
}

// One world unit is 100 CSS px: boxes come out a unit or two wide, where rapier's tolerances are
// at home.
export const PX = 0.01;

// Real puzzle boxes are about a sixth as deep as they are wide.
export const BOX_DEPTH_PER_WIDTH = 0.16;

/** A point on the stage (CSS px, y down) in world units (y up), the stage's centre at the origin. */
export function toWorld(
  layout: Pick<PlayLayout, "width" | "height">,
  x: number,
  y: number,
): [number, number] {
  return [(x - layout.width / 2) * PX, (layout.height / 2 - y) * PX];
}

export interface Eye {
  x: number;
  y: number;
  /** Distance from the plane the box fronts stand in (z = 0). */
  z: number;
}

/**
 * The asymmetric frustum, at the near plane, of an eye looking straight down -z from `eye` whose
 * view of the z = 0 plane is exactly the stage: wherever the eye stands, the box fronts land on
 * the pixels the flat row drew them on, and only their depth shows more or less. Pure.
 */
export function stageFrustum(
  layout: Pick<PlayLayout, "width" | "height">,
  eye: Eye,
  near: number,
): { left: number; right: number; top: number; bottom: number } {
  const halfW = (layout.width / 2) * PX;
  const halfH = (layout.height / 2) * PX;
  const k = near / eye.z;
  return {
    left: (-halfW - eye.x) * k,
    right: (halfW - eye.x) * k,
    top: (halfH - eye.y) * k,
    bottom: (-halfH - eye.y) * k,
  };
}

// The eye starts so far off that the scene is all but flat, like the row it replaces, and comes
// in to where box sides and tops show; its height keeps the tops in view.
const FLAT_EYE = 400;

/**
 * Where the eye stands at `depth` (0 = flat, 1 = in 3D). Perspective strength (1 / distance), not
 * distance, follows the eased progress, so the depth grows evenly instead of all at the end. Pure.
 */
export function eyeAt(
  layout: Pick<PlayLayout, "width" | "height">,
  depth: number,
): Eye {
  const near = Math.max(10, layout.width * PX * 1.1);
  const strength = 1 / FLAT_EYE + (1 / near - 1 / FLAT_EYE) * depth;
  const z = 1 / strength;
  const y = depth * ((layout.height / 2) * PX + 0.25 * near);
  return { x: 0, y, z };
}

/** Strong ease-out (cubic), the house curve's shape for frame-driven motion. Pure. */
export function easeOut(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - c, 3);
}

/**
 * Measures the flat row for the scene: every box face (`[data-shelf-box]`) and the ledge
 * (`[data-shelf-ledge]`) relative to the stage, plus the colours and fonts the page resolved.
 * Client only.
 */
export function measurePlayLayout(
  stage: HTMLElement,
  boxes: ReadonlyArray<{ cover?: string; lid: PlayBox["lid"] }>,
): PlayLayout {
  const frame = stage.getBoundingClientRect();
  const faces = stage.querySelectorAll<HTMLElement>("[data-shelf-box]");
  const ledgeEl = stage.querySelector<HTMLElement>("[data-shelf-ledge]");
  const rel = (r: DOMRect) => ({
    x: r.left - frame.left,
    y: r.top - frame.top,
    w: r.width,
    h: r.height,
  });
  const root = getComputedStyle(document.documentElement);
  return {
    width: frame.width,
    height: frame.height,
    boxes: Array.from(faces, (face, i) => {
      // A cover that failed to load is already a lid on the row.
      const isCover = face.tagName === "IMG";
      return {
        ...rel(face.getBoundingClientRect()),
        cover: isCover ? boxes[i]?.cover : undefined,
        lid: boxes[i]?.lid ?? { color: "#146350", title: "" },
      };
    }),
    ledge: ledgeEl
      ? rel(ledgeEl.getBoundingClientRect())
      : { x: 0, y: frame.height - 9, w: frame.width, h: 9 },
    plank: ledgeEl ? getComputedStyle(ledgeEl).backgroundColor : "#e4c79a",
    fonts: {
      heading:
        root.getPropertyValue("--font-heading").trim() || "Georgia, serif",
      text: root.getPropertyValue("--font-sans").trim() || "sans-serif",
    },
  };
}
