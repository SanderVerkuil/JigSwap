"use node";

import webpEncoderFactory, {
  type WebPModule,
} from "@jsquash/webp/codec/enc/webp_enc.js";
import { defaultOptions } from "@jsquash/webp/meta.js";
import { initEmscriptenModule } from "@jsquash/webp/utils.js";
import { checkImageBytes, type ImageGuardFailure } from "./guards";
import { decodeUpright } from "./normaliseImage";
import { findMetadata, stripImageMetadata } from "./stripMetadata";
import { WEBP_ENCODER_WASM_BASE64 } from "./webpEncoderWasm";

// Renditions: smaller WebP copies of a stored image for the places that show it small (cards,
// thumbnails, plank textures), so a page does not download full-size box art or photos to draw
// a 200 px tile (PERF-C1). Node only (jimp, a WASM WebP encoder).
//
// Input is the stored CLEAN blob (already re-encoded by the moderation pipeline: metadata-free
// and upright). It still goes through the pipeline's input guards (checkImageBytes: size, magic
// bytes, the header's pixel count) before anything decodes it, and a body that does not decode
// is refused as "decode_failed". It is decoded as a browser shows it: decodeUpright decodes no
// Exif, so the Orientation is read here and handed to it, as in the pipeline. A clean blob no
// longer has one, but box art from before the metadata strip still may.
//
// - Sizes (renditionSizes): one per rung of the ladder (by default RENDITION_LADDER: 480, 640 and
//   960 px wide, aspect kept) narrower than the image, plus, in the place of the first rung that
//   is not, a WebP at the image's own width. A card that needs more pixels than the narrower
//   rungs then still gets a WebP rather than the original, which may be a PNG several times the
//   size (box art with transparency is stored as PNG). 640 is there for 2x screens: a 240-330 px
//   card needs about 500-660 px. An image only ever shown at one small size has a ladder of one
//   rung (THUMBNAIL_LADDER, MESSAGE_THUMB_LADDER), so it costs one extra blob instead of three.
// - Bytes: a rendition is kept only when it is at most RENDITION_MAX_BYTE_RATIO of the source's
//   bytes; otherwise the browser is better off with the original (a ~1000 px JPEG that is
//   already compressed hard costs about as much as its 960 px WebP). The dropped slots are
//   reported in `notSmaller`.
// - Downscale: jimp's default resampler, which averages every source pixel under each target
//   pixel (an area filter), so fine detail such as box-art text does not alias, and ignores the
//   colour of fully transparent pixels, so cut-out edges do not darken. (jimp's bicubic and
//   hermite modes interpolate from four samples and alias at these ratios.) Largest first, the
//   next from the previous one, in place, so the decoded source is never copied.
// - Encode: lossy WebP at WEBP_QUALITY via libwebp (@jsquash/webp, its non-SIMD build embedded
//   as base64 in webpEncoderWasm). An image with transparency keeps its alpha. The encoder
//   writes no metadata; findMetadata checks every output anyway, and one that has any throws
//   instead of being returned. A colour profile is not carried over (nor is it by the
//   pipeline's JPEG/PNG re-encode).
//
// The encoder glue is loaded directly: @jsquash/webp's own `init` picks the SIMD glue whenever
// the runtime supports SIMD, which does not fit the embedded non-SIMD module.

/**
 * The rendition slots (imageRenditions' fields) and their widths in px, narrowest first. A slot
 * whose width the image does not exceed holds a WebP at the image's own width instead, and the
 * slots after it stay empty (renditionSizes).
 */
export const RENDITION_LADDER = [
  { slot: "small", width: 480 },
  { slot: "medium", width: 640 },
  { slot: "large", width: 960 },
] as const;

export type RenditionSlot = (typeof RENDITION_LADDER)[number]["slot"];

export type RenditionLadder = readonly {
  slot: RenditionSlot;
  width: number;
}[];

/**
 * One WebP for an image only ever shown as a small tile or avatar (a completion photo's 44 px tile,
 * a circle icon's 40-56 px avatar): 256 px still fills them at 3x when `object-cover` crops the
 * long side. The photo viewer opens the original.
 */
export const THUMBNAIL_LADDER = [
  { slot: "small", width: 256 },
] as const satisfies RenditionLadder;

/**
 * One WebP for a message photo (messageAttachments.thumbFileId): the thread's tile is at most 288
 * px wide, so 640 px covers it at 2x. The photo viewer opens the original.
 */
export const MESSAGE_THUMB_LADDER = [
  { slot: "small", width: 640 },
] as const satisfies RenditionLadder;

/** A rendition is kept only when its bytes are at most this share of the source's. */
export const RENDITION_MAX_BYTE_RATIO = 0.9;

/** Lossy WebP quality (libwebp's 0..100 scale): ample for a card or a thumbnail. */
const WEBP_QUALITY = 80;

/** WebP cannot hold a side longer than this. */
const WEBP_MAX_DIMENSION = 16383;

export type RenditionSize = {
  slot: RenditionSlot;
  width: number;
  height: number;
};

export type Rendition = RenditionSize & { bytes: Uint8Array };

export type RenditionSet =
  | {
      ok: true;
      /** The source image's size as shown. */
      width: number;
      height: number;
      /** Narrowest first; empty when none came out clearly smaller than the source. */
      renditions: Rendition[];
      /** Slots made but not kept: not clearly smaller than the source (see the header). */
      notSmaller: RenditionSlot[];
    }
  | { ok: false; reason: ImageGuardFailure };

/** The rendition sizes for an image of `width` x `height` px, narrowest first (see the header). */
export const renditionSizes = (
  width: number,
  height: number,
  ladder: RenditionLadder = RENDITION_LADDER,
): RenditionSize[] => {
  const sizes: RenditionSize[] = [];
  for (const rung of ladder) {
    const w = Math.min(rung.width, width);
    sizes.push({
      slot: rung.slot,
      width: w,
      height: Math.max(1, Math.round((height * w) / width)),
    });
    if (w === width) break;
  }
  return sizes.filter((size) => size.height <= WEBP_MAX_DIMENSION);
};

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
  ladder: RenditionLadder = RENDITION_LADDER,
): Promise<RenditionSet> => {
  const guard = checkImageBytes(bytes);
  if (!guard.ok) return guard;
  const stripped =
    guard.format === "gif"
      ? { bytes, orientation: 1 }
      : stripImageMetadata(bytes, guard.format);
  if (stripped === null) return { ok: false, reason: "decode_failed" };
  let image: Awaited<ReturnType<typeof decodeUpright>>;
  try {
    image = await decodeUpright(
      stripped.bytes,
      guard.format,
      stripped.orientation,
    );
  } catch {
    return { ok: false, reason: "decode_failed" };
  }
  const { width, height } = image.bitmap;
  const maxBytes = bytes.byteLength * RENDITION_MAX_BYTE_RATIO;
  const renditions: Rendition[] = [];
  const notSmaller: RenditionSlot[] = [];
  for (const size of renditionSizes(width, height, ladder).reverse()) {
    if (image.bitmap.width !== size.width) {
      image.resize({ w: size.width, h: size.height });
    }
    const out = await encodeWebp(image.bitmap);
    if (out.byteLength <= maxBytes) renditions.unshift({ ...size, bytes: out });
    else notSmaller.unshift(size.slot);
  }
  return { ok: true, width, height, renditions, notSmaller };
};
