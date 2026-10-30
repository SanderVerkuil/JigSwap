"use node";

import webpEncoderFactory, {
  type WebPModule,
} from "@jsquash/webp/codec/enc/webp_enc.js";
import { defaultOptions } from "@jsquash/webp/meta.js";
import { initEmscriptenModule } from "@jsquash/webp/utils.js";
import { checkImageBytes, type ImageGuardFailure } from "./guards";
import { decodeUpright } from "./normaliseImage";
import { findMetadata } from "./stripMetadata";
import { WEBP_ENCODER_WASM_BASE64 } from "./webpEncoderWasm";

// Renditions: smaller WebP copies of a stored image for the places that show it small (cards,
// thumbnails, plank textures), so a page does not download full-size box art or photos to draw
// a 200 px tile (PERF-C1). Node only (jimp, a WASM WebP encoder).
//
// Input is the stored CLEAN blob (already re-encoded by the moderation pipeline: metadata-free
// and upright). It still goes through the pipeline's input guards (checkImageBytes: size, magic
// bytes, the header's pixel count) before anything decodes it, and a body that does not decode
// is refused as "decode_failed". It is decoded as a browser shows it (jimp applies an Exif
// Orientation, which a clean blob no longer has).
//
// - Widths: each of RENDITION_WIDTHS narrower than the image (renditionSizes), aspect kept;
//   an image no wider than the smallest one gets none and is served as it is.
// - Downscale: jimp's default resampler, which averages every source pixel under each target
//   pixel (an area filter), so fine detail such as box-art text does not alias, and ignores the
//   colour of fully transparent pixels, so cut-out edges do not darken. (jimp's bicubic and
//   hermite modes interpolate from four samples and alias at these ratios.) Largest first, the
//   next from the previous one (960 to 480 is an exact halving), in place, so the decoded
//   source is never copied.
// - Encode: lossy WebP at WEBP_QUALITY via libwebp (@jsquash/webp, its non-SIMD build embedded
//   as base64 in webpEncoderWasm). An image with transparency keeps its alpha. The encoder
//   writes no metadata; findMetadata checks every output anyway, and one that has any throws
//   instead of being returned. A colour profile is not carried over (nor is it by the
//   pipeline's JPEG/PNG re-encode).
//
// The encoder glue is loaded directly: @jsquash/webp's own `init` picks the SIMD glue whenever
// the runtime supports SIMD, which does not fit the embedded non-SIMD module.

/** The widths, in px, of the renditions made for an image wider than each. */
export const RENDITION_WIDTHS = [480, 960] as const;

/** Lossy WebP quality (libwebp's 0..100 scale): ample for a card or a thumbnail. */
const WEBP_QUALITY = 80;

/** WebP cannot hold a side longer than this. */
const WEBP_MAX_DIMENSION = 16383;

export type Rendition = { width: number; height: number; bytes: Uint8Array };

export type RenditionSet =
  | {
      ok: true;
      /** The source image's size as shown. */
      width: number;
      height: number;
      /** Narrowest first; empty when the source is no wider than every rendition width. */
      renditions: Rendition[];
    }
  | { ok: false; reason: ImageGuardFailure };

/** The rendition sizes for an image of `width` x `height` px, narrowest first. */
export const renditionSizes = (
  width: number,
  height: number,
): { width: number; height: number }[] =>
  RENDITION_WIDTHS.filter((w) => w < width)
    .map((w) => ({
      width: w,
      height: Math.max(1, Math.round((height * w) / width)),
    }))
    .filter((size) => size.height <= WEBP_MAX_DIMENSION);

let webpEncoderReady: Promise<WebPModule> | null = null;

const webpEncoder = (): Promise<WebPModule> => {
  webpEncoderReady ??= WebAssembly.compile(
    Buffer.from(WEBP_ENCODER_WASM_BASE64, "base64"),
  )
    .then((module) => initEmscriptenModule(webpEncoderFactory, module))
    .catch((error: unknown) => {
      webpEncoderReady = null;
      throw error;
    });
  return webpEncoderReady;
};

const encodeWebp = async (bitmap: {
  width: number;
  height: number;
  data: Uint8Array;
}): Promise<Uint8Array> => {
  const encoder = await webpEncoder();
  // slice(): the codec's typings take an ArrayBuffer-backed view (it copies the pixels anyway).
  const out = encoder.encode(bitmap.data.slice(), bitmap.width, bitmap.height, {
    ...defaultOptions,
    quality: WEBP_QUALITY,
  });
  if (!out) throw new Error("WebP encoding failed");
  const metadata = findMetadata(out, "webp");
  if (metadata === null || metadata.length > 0) {
    throw new Error(
      `WebP rendition carries metadata: ${metadata?.join(",") ?? "malformed"}`,
    );
  }
  return out;
};

/**
 * The renditions of a stored image (see the header), or the guard's reason when the bytes are
 * refused. Throws only when the encoder fails.
 */
export const encodeRenditions = async (
  bytes: Uint8Array,
): Promise<RenditionSet> => {
  const guard = checkImageBytes(bytes);
  if (!guard.ok) return guard;
  let image: Awaited<ReturnType<typeof decodeUpright>>;
  try {
    image = await decodeUpright(bytes, guard.format, 1);
  } catch {
    return { ok: false, reason: "decode_failed" };
  }
  const { width, height } = image.bitmap;
  const renditions: Rendition[] = [];
  for (const size of renditionSizes(width, height).reverse()) {
    image.resize({ w: size.width, h: size.height });
    renditions.unshift({ ...size, bytes: await encodeWebp(image.bitmap) });
  }
  return { ok: true, width, height, renditions };
};
