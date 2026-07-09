import { clampCropArea, type PixelArea, rotateSize } from "./crop-math";

// Browser-only canvas bake for the image editor. Loads the source with
// crossOrigin="anonymous" BEFORE setting src (the box-art precedent in
// marketing/plank-3d/box-art.ts — drawImage works on a tainted canvas but
// toBlob/getImageData throw SecurityError, so remote sources MUST be CORS-served).
const loadEditorImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("image load failed"));
    image.src = src;
  });

// Draw the source rotated around its center onto a bounding canvas, cut the crop
// area out, and return it as a File ready for the existing upload pipelines.
export async function bakeImage(
  src: string,
  cropAreaPixels: PixelArea,
  rotationDeg: number,
  fileName: string,
  mimeType = "image/jpeg",
): Promise<File> {
  const image = await loadEditorImage(src);
  const rotated = rotateSize(
    image.naturalWidth,
    image.naturalHeight,
    rotationDeg,
  );

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(rotated.width);
  canvas.height = Math.ceil(rotated.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d unavailable");
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotationDeg * Math.PI) / 180);
  ctx.translate(-image.naturalWidth / 2, -image.naturalHeight / 2);
  ctx.drawImage(image, 0, 0);

  const area = clampCropArea(cropAreaPixels, canvas.width, canvas.height);
  const out = document.createElement("canvas");
  out.width = area.width;
  out.height = area.height;
  const outCtx = out.getContext("2d");
  if (!outCtx) throw new Error("canvas 2d unavailable");
  outCtx.drawImage(
    canvas,
    area.x,
    area.y,
    area.width,
    area.height,
    0,
    0,
    area.width,
    area.height,
  );

  // toBlob throws SecurityError here when the canvas is tainted (non-CORS remote src).
  const blob = await new Promise<Blob | null>((resolve) =>
    out.toBlob(resolve, mimeType, 0.9),
  );
  if (!blob) throw new Error("bake produced no blob");
  return new File([blob], fileName, { type: mimeType });
}
