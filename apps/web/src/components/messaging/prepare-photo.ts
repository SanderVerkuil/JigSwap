// Browser-side steps of sending a message photo (spec 2.2): re-encode the
// picked file to a JPEG (long edge ≤ 1600 px, q 0.8) through a canvas, which
// also drops EXIF/GPS and converts HEIC/WebP wherever the browser can decode
// them; then POST it to the upload URL with progress.
import Compressor from "compressorjs";

const MAX_EDGE = 1600;
const QUALITY = 0.8;

/** The file picker's accept list. */
export const PHOTO_ACCEPT = "image/jpeg,image/png,image/heic,image/webp";

export type PreparedPhoto = { file: Blob; width: number; height: number };

/** Rejects when the browser cannot decode the file. */
export function preparePhoto(file: File): Promise<PreparedPhoto> {
  return new Promise((resolve, reject) => {
    let width = 0;
    let height = 0;
    new Compressor(file, {
      quality: QUALITY,
      maxWidth: MAX_EDGE,
      maxHeight: MAX_EDGE,
      mimeType: "image/jpeg",
      // Always use the re-encode: strict mode would hand back the original
      // (EXIF and all) whenever it is the smaller file.
      strict: false,
      convertSize: 0,
      retainExif: false,
      checkOrientation: true,
      drew: (_context, canvas) => {
        width = canvas.width;
        height = canvas.height;
      },
      success: (result) => {
        if (result.type !== "image/jpeg" || width < 1 || height < 1) {
          reject(new Error("not converted"));
          return;
        }
        resolve({ file: result, width, height });
      },
      error: reject,
    });
  });
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
