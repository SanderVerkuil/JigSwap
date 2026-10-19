// What the image editor's Apply hands back. The editor bakes its result
// through a canvas; in a browser that scrambles canvas read-back (Firefox
// resistFingerprinting, see lib/prepare-photo) that bake is noise. Then an
// unedited photo goes up as the original file (the server strips its
// metadata), and an edited one is not uploaded at all: the member is offered
// the original instead.
export type ExportChoice = "canvas" | "original" | "blocked";

export function exportChoice({
  canvasTrusted,
  rotation,
  cropChanged,
}: {
  canvasTrusted: boolean;
  /** The rotation in degrees (0 = untouched). */
  rotation: number;
  /** Whether the member moved, resized or auto-cropped the frame. */
  cropChanged: boolean;
}): ExportChoice {
  if (canvasTrusted) return "canvas";
  return rotation !== 0 || cropChanged ? "blocked" : "original";
}
