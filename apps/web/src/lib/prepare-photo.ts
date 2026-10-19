// Browser-side preparation of every photo upload (message photos, spec 2.2;
// completion photos; box art): re-encode the picked file to a JPEG (long edge
// ≤ 1600 px, q 0.8) through a canvas, which also drops EXIF/GPS and converts
// HEIC/WebP wherever the browser can decode them. Message photos are then
// POSTed to the upload URL with progress (uploadWithProgress).
//
// No compressorjs: it skips the canvas (and hands back the original file,
// EXIF/GPS included) unless canvas read-back is exact, so in browsers that
// add a little read-back noise against fingerprinting (e.g. Helium, Brave)
// every photo went up as the original. Their canvas output is fine. Only a
// scrambled read-back (Firefox resistFingerprinting) means the JPEG would be
// noise too.

const MAX_EDGE = 1600;
const QUALITY = 0.8;

/** The file picker's accept list. */
export const PHOTO_ACCEPT = "image/jpeg,image/png,image/heic,image/webp";

export type PreparedPhoto = { file: Blob; width: number; height: number };

// Read-back drift allowed per channel: anti-fingerprinting noise is a few
// levels; random bytes fall outside it.
const READ_BACK_TOLERANCE = 16;

/** Whether canvas pixels come back (nearly) as written. */
function canvasReadsBack(context: CanvasRenderingContext2D): boolean {
  const probe = context.createImageData(2, 1);
  probe.data.set([12, 23, 34, 255, 45, 56, 67, 255]);
  context.putImageData(probe, 0, 0);
  const back = context.getImageData(0, 0, 2, 1).data;
  return probe.data.every(
    (value, i) => Math.abs(back[i] - value) <= READ_BACK_TOLERANCE,
  );
}

/** Rejects when the browser cannot decode the file. */
export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    // Browsers apply EXIF orientation when decoding, so the size is upright.
    await image.decode();
    const scale = Math.min(
      1,
      MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight),
    );
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context || !canvasReadsBack(context)) throw new Error("no canvas");
    // JPEG has no alpha: put transparent PNG areas on white, not black.
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", QUALITY),
    );
    if (blob?.type !== "image/jpeg") throw new Error("not converted");
    return { file: blob, width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** POST the blob to a Convex upload URL; resolves with its storage id. */
export function uploadWithProgress(
  url: string,
  blob: Blob,
  onProgress: (fraction: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("Content-Type", blob.type);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(`upload failed: ${xhr.status}`));
        return;
      }
      try {
        const { storageId } = JSON.parse(xhr.responseText) as {
          storageId?: string;
        };
        if (storageId) resolve(storageId);
        else reject(new Error("no storageId"));
      } catch (error) {
        reject(error);
      }
    };
    xhr.onerror = () => reject(new Error("upload failed"));
    xhr.send(blob);
  });
}
