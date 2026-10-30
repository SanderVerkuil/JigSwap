"use node";

import webpDecoderFactory from "@jsquash/webp/codec/dec/webp_dec.js";
import { initEmscriptenModule } from "@jsquash/webp/utils.js";
import { Jimp } from "jimp";
import {
  checkImageBytes,
  JPEG_DECODER_MEMORY_MB,
  jpegDecodeInput,
  MAX_IMAGE_PIXELS,
} from "./guards";
import { applyOrientation, type Bitmap } from "./orientation";
import {
  jpegIccSegments,
  stripImageMetadata,
  type StrippableFormat,
} from "./stripMetadata";
import { WEBP_DECODER_WASM_BASE64 } from "./webpDecoderWasm";

// Strip an image's metadata and turn its pixels upright. Node only (jimp, a WASM WebP decoder).
//
// `stripImageMetadata` drops every Exif block, Orientation included. An image whose Exif held
// no Orientation (or 1) is stored as the stripped bytes, untouched. One with 2..8 is decoded,
// turned upright (lib/imageModeration/orientation) and re-encoded without any metadata:
// - JPEG stays JPEG: quality 95, no chroma subsampling (jpeg-js), so one generation is not
//   visible. Its RGB ICC profile (APP2) is copied over, so wide-gamut (Display P3) phone photos
//   keep their colours; a CMYK or grey profile is not (the re-encode is RGB).
// - PNG stays PNG (lossless).
// - WebP: jimp has no WebP encoder, so it becomes PNG when it has transparency, else JPEG
//   (quality 95), like the moderation pipeline's re-encode. The caller stores it under the
//   returned mime.
// A PNG's or WebP's colour profile and gamma chunks are not carried over: neither format takes
// an Orientation from cameras, so this path is rare.
//
// WebP is decoded with libwebp compiled to WASM (@jsquash/webp), embedded as base64
// (webpDecoderWasm) so it ships inside the bundled action. jimp decodes JPEG and PNG; the bytes
// it gets carry no Exif, so jimp's own Exif rotation never applies on top.

const JPEG_QUALITY = 95;

// The WebP decoder (libwebp), compiled once per process. Every decode instantiates it afresh: an
// instance's heap only ever grows (to what the largest image it decoded needed), so a cached one
// would keep the high-water mark of the biggest WebP resident for every decode after it, in a
// 512 MiB action (SEC-77). A fresh instance is dropped with its heap once its decode returns
// (the pixels are copied out of it).
let webpDecoderModule: Promise<WebAssembly.Module> | null = null;

// The decoder's glue defines a global ImageData (what it returns the pixels as) when there is
// none, as in Node, from inside the first instance it creates: that class keeps the instance, heap
// included, reachable for the life of the process. Defined here before any instance exists, no
// instance is kept.
const defineImageData = () => {
  if ("ImageData" in globalThis) return;
  Object.defineProperty(globalThis, "ImageData", {
    configurable: true,
    writable: true,
    value: class ImageData {
      constructor(
        readonly data: Uint8ClampedArray,
        readonly width: number,
        readonly height: number,
      ) {}
    },
  });
};

/** The decoder @jsquash/webp's glue builds: the pixels, or null when the bytes do not decode. */
type WebpDecoder = { decode(data: Uint8Array): ImageData | null };

const decodeWebp = async (bytes: Uint8Array): Promise<Bitmap> => {
  webpDecoderModule ??= WebAssembly.compile(
    Buffer.from(WEBP_DECODER_WASM_BASE64, "base64"),
  ).catch((error: unknown) => {
    webpDecoderModule = null;
    throw error;
  });
  const wasm = await webpDecoderModule;
  defineImageData();
  const decoder: WebpDecoder = await initEmscriptenModule(
    webpDecoderFactory,
    wasm,
  );
  const image = decoder.decode(bytes);
  if (!image) throw new Error("WebP decode failed");
  const data = image.data;
  return {
    width: image.width,
    height: image.height,
    data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
  };
};

/**
 * Decode stripped bytes (no Exif) into a jimp image turned upright for `orientation` (1..8).
 * GIF goes through jimp too (first frame, at the logical screen size). Throws when the bytes do
 * not decode, when the input guards (lib/imageModeration/guards) refuse them, and when the
 * decoded bitmap is not the size the header announced: the guards bound the decode by the
 * header alone, so a decoder that reads a bigger image from the same bytes is never let through
 * (SEC-17). A JPEG is decoded from exactly the bytes its frame was checked in
 * (jpegDecodeInput), under jpeg-js's own caps on resolution and allocation as a backstop
 * (SEC-18); hitting one is a throw like any other decode failure.
 */
export const decodeUpright = async (
  input: Uint8Array,
  format: StrippableFormat | "gif",
  orientation: number,
) => {
  const bytes = format === "jpeg" ? jpegDecodeInput(input) : input;
  const header = checkImageBytes(bytes);
  if (!header.ok) throw new Error(`refused before decode: ${header.reason}`);
  if (header.format !== format) {
    throw new Error(`refused before decode: ${header.format}, not ${format}`);
  }
  const assertHeaderSize = (bitmap: { width: number; height: number }) => {
    if (bitmap.width !== header.width || bitmap.height !== header.height) {
      throw new Error(
        `decoded ${bitmap.width}x${bitmap.height}, the header said ${header.width}x${header.height}`,
      );
    }
  };
  if (format === "webp") {
    const bitmap = await decodeWebp(bytes);
    assertHeaderSize(bitmap);
    return Jimp.fromBitmap(applyOrientation(bitmap, orientation));
  }
  const image = await Jimp.fromBuffer(Buffer.from(bytes), {
    "image/jpeg": {
      maxResolutionInMP: MAX_IMAGE_PIXELS / 1e6,
      maxMemoryUsageInMB: JPEG_DECODER_MEMORY_MB,
    },
  });
  assertHeaderSize(image.bitmap);
  if (orientation < 2 || orientation > 8) return image;
  const bitmap = image.bitmap;
  return Jimp.fromBitmap(
    applyOrientation(
      { width: bitmap.width, height: bitmap.height, data: bitmap.data },
      orientation,
    ),
  );
};

/** Whether a decoded RGBA bitmap has any pixel that is not fully opaque. */
export const hasTransparency = (data: Uint8Array): boolean => {
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) return true;
  }
  return false;
};

// Put the source's RGB ICC profile segments right after the re-encode's SOI and JFIF APP0.
const withIcc = (jpeg: Uint8Array, icc: Uint8Array[]): Uint8Array => {
  if (icc.length === 0) return jpeg;
  const at = jpeg[3] === 0xe0 ? 4 + ((jpeg[4] << 8) | jpeg[5]) : 2;
  const parts = [jpeg.subarray(0, at), ...icc, jpeg.subarray(at)];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

export type CleanImage = {
  bytes: Uint8Array;
  /** What the bytes are now (a turned WebP becomes JPEG or PNG); store them as `image/<format>`. */
  format: StrippableFormat;
  mime: `image/${StrippableFormat}`;
  /** Whether the pixels were turned upright (decoded and re-encoded). */
  normalised: boolean;
};

/**
 * The image without metadata and upright (see the header), or null when its block structure is
 * malformed. Throws when an image that needs turning does not decode.
 */
export const stripAndNormalise = async (
  bytes: Uint8Array,
  format: StrippableFormat,
): Promise<CleanImage | null> => {
  const stripped = stripImageMetadata(bytes, format);
  if (!stripped) return null;
  if (stripped.orientation === 1) {
    return {
      bytes: stripped.bytes,
      format,
      mime: `image/${format}`,
      normalised: false,
    };
  }
  const image = await decodeUpright(
    stripped.bytes,
    format,
    stripped.orientation,
  );
  if (
    format === "png" ||
    (format === "webp" && hasTransparency(image.bitmap.data))
  ) {
    const png = await image.getBuffer("image/png");
    return {
      bytes: new Uint8Array(png),
      format: "png",
      mime: "image/png",
      normalised: true,
    };
  }
  const jpeg = new Uint8Array(
    await image.getBuffer("image/jpeg", { quality: JPEG_QUALITY }),
  );
  return {
    bytes:
      format === "jpeg" ? withIcc(jpeg, jpegIccSegments(stripped.bytes)) : jpeg,
    format: "jpeg",
    mime: "image/jpeg",
    normalised: true,
  };
};
