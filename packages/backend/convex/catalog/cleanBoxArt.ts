"use node";

import { checkImageBytes } from "../lib/imageModeration/guards";
import { stripAndNormalise } from "../lib/imageModeration/normaliseImage";
import { findMetadata } from "../lib/imageModeration/stripMetadata";
import type { BoxArtRefusal } from "./boxArtUploads";

/**
 * Validate, strip and turn box-art bytes upright: at most 10 MB, a JPEG, PNG or WebP by its
 * magic bytes, a usable header within the pixel budget, a well-formed block structure. An Exif
 * Orientation is applied to the pixels (lib/imageModeration/normaliseImage), so the stored
 * image may come back in another format (a turned WebP is stored as JPEG or PNG): store it
 * under the returned mime. An image that needs turning but does not decode is "malformed". GIF
 * is refused: there is no byte-level stripper for it and box art never needs it.
 */
export const cleanBoxArt = async (
  bytes: Uint8Array,
): Promise<
  | { ok: true; bytes: Uint8Array; mime: string }
  | { ok: false; reason: BoxArtRefusal }
> => {
  const guard = checkImageBytes(bytes);
  if (!guard.ok) {
    return {
      ok: false,
      reason: guard.reason === "decode_failed" ? "malformed" : guard.reason,
    };
  }
  if (guard.format === "gif")
    return { ok: false, reason: "unsupported_format" };
  const clean = await stripAndNormalise(bytes, guard.format).catch(() => null);
  if (!clean || findMetadata(clean.bytes, clean.format)?.length !== 0) {
    return { ok: false, reason: "malformed" };
  }
  return { ok: true, bytes: clean.bytes, mime: clean.mime };
};
