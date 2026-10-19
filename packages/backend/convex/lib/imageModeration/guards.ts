// Input guards for uploaded images, run by the moderation pipeline BEFORE anything decodes the
// bytes. Pure functions on byte buffers (no Convex ctx, no jimp), so they are unit-tested directly.
//
// - Size: the stored blob is at most MAX_IMAGE_UPLOAD_BYTES (checked from the storage metadata
//   before the download, and again on the downloaded bytes).
// - Type: the magic bytes say JPEG, PNG, WebP or GIF. Anything else (SVG, HTML, PDF, BMP, TIFF,
//   HEIC, ...) is refused, whatever content type the client claimed.
// - Pixels: the width x height read from the header is at most MAX_IMAGE_PIXELS, so a tiny file
//   that would decompress to a huge bitmap (a decompression bomb) is refused before decode.
//
// WebP: jimp 1.x has no WebP decoder, so the pipeline cannot re-encode it. It strips the WebP's
// EXIF/XMP chunks at byte level instead (stripMetadata) and stores those bytes (no blurhash).
// WebP stays accepted because phones and browsers hand it over and the web client may upload the
// original when it cannot re-encode in the browser.
//
// GIF: jimp decodes the first frame into a bitmap of the logical screen size (omggif), so the
// screen size bounds the decode, and the first frame must fit inside the screen; the re-encode
// keeps that one frame.

/** Largest accepted upload, in bytes (10 MB). */
export const MAX_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Largest accepted image, in pixels (25 MP). */
export const MAX_IMAGE_PIXELS = 25_000_000;

export type ImageFormat = "jpeg" | "png" | "webp" | "gif";

/** Why an upload was refused. Stored as the row's `moderationReason`. */
export type ImageGuardFailure =
  | "too_large" // more than MAX_IMAGE_UPLOAD_BYTES
  | "unsupported_format" // the magic bytes are not JPEG / PNG / WebP / GIF
  | "unreadable_header" // a supported format whose header has no usable dimensions
  | "too_many_pixels" // more than MAX_IMAGE_PIXELS
  | "decode_failed"; // a JPEG / PNG / GIF header over a body jimp cannot decode (set by the pipeline)

/** The verdict label a refused upload is recorded with. */
export const INVALID_IMAGE_LABEL = "invalid_image";

export type ImageGuardResult =
  | { ok: true; format: ImageFormat; width: number; height: number }
  | { ok: false; reason: ImageGuardFailure };

const ascii = (bytes: Uint8Array, offset: number, text: string): boolean => {
  if (bytes.length < offset + text.length) return false;
  for (let i = 0; i < text.length; i++) {
    if (bytes[offset + i] !== text.charCodeAt(i)) return false;
  }
  return true;
};

const u16be = (b: Uint8Array, i: number): number => (b[i] << 8) | b[i + 1];
const u16le = (b: Uint8Array, i: number): number => b[i] | (b[i + 1] << 8);
const u24le = (b: Uint8Array, i: number): number =>
  b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const u32be = (b: Uint8Array, i: number): number =>
  ((b[i] << 24) >>> 0) + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]);

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The image format the magic bytes announce, or null for anything else. */
export const sniffImageFormat = (bytes: Uint8Array): ImageFormat | null => {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "jpeg";
  }
  if (
    bytes.length >= PNG_SIGNATURE.length &&
    PNG_SIGNATURE.every((byte, i) => bytes[i] === byte)
  ) {
    return "png";
  }
  if (ascii(bytes, 0, "GIF87a") || ascii(bytes, 0, "GIF89a")) return "gif";
  if (ascii(bytes, 0, "RIFF") && ascii(bytes, 8, "WEBP")) return "webp";
  return null;
};

// JPEG: walk the marker segments up to the first start-of-frame (SOF0..SOF15, except DHT C4,
// JPG C8 and DAC CC), whose payload is [precision][height u16][width u16].
const jpegDimensions = (
  b: Uint8Array,
): { width: number; height: number } | null => {
  let i = 2;
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    // Fill bytes: a run of 0xFF before the marker.
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    // Stand-alone markers carry no length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    // End of image / start of scan before any frame header: no dimensions.
    if (marker === 0xd9 || marker === 0xda) return null;
    const length = u16be(b, i + 2);
    if (length < 2) return null;
    const isSof =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (isSof) {
      if (i + 9 > b.length) return null;
      return { height: u16be(b, i + 5), width: u16be(b, i + 7) };
    }
    i += 2 + length;
  }
  return null;
};

// PNG: the first chunk is IHDR, whose data starts with width u32 and height u32.
const pngDimensions = (
  b: Uint8Array,
): { width: number; height: number } | null => {
  if (b.length < 24 || !ascii(b, 12, "IHDR")) return null;
  return { width: u32be(b, 16), height: u32be(b, 20) };
};

// GIF: the logical screen descriptor right after the 6-byte signature (u16 LE each), checked
// together with the FIRST image descriptor, which is the frame jimp decodes: it must lie inside
// the logical screen (and so within the pixel budget the screen is checked against). Anything
// before it must be well-formed extension blocks. No image descriptor => no usable header.
const gifDimensions = (
  b: Uint8Array,
): { width: number; height: number } | null => {
  if (b.length < 13) return null;
  const screen = { width: u16le(b, 6), height: u16le(b, 8) };
  const flags = b[10];
  // Global colour table: 3 * 2^(n+1) bytes when the flag bit is set.
  let i = 13 + (flags & 0x80 ? 3 * (1 << ((flags & 0x07) + 1)) : 0);
  while (i < b.length) {
    const block = b[i];
    if (block === 0x2c) {
      // Image descriptor: left, top, width, height (u16 LE each).
      if (i + 9 >= b.length) return null;
      const left = u16le(b, i + 1);
      const top = u16le(b, i + 3);
      const width = u16le(b, i + 5);
      const height = u16le(b, i + 7);
      if (
        width === 0 ||
        height === 0 ||
        left + width > screen.width ||
        top + height > screen.height
      ) {
        return null;
      }
      return screen;
    }
    if (block !== 0x21) return null; // trailer (0x3B) or garbage before any frame
    // Extension: introducer, label, then size-prefixed sub-blocks ending with a 0 size.
    i += 2;
    while (i < b.length && b[i] !== 0) i += b[i] + 1;
    i += 1;
  }
  return null;
};

// WebP: the first chunk after "RIFF....WEBP" is VP8 (lossy), VP8L (lossless) or VP8X (extended).
const webpDimensions = (
  b: Uint8Array,
): { width: number; height: number } | null => {
  if (ascii(b, 12, "VP8 ")) {
    // Frame tag (3 bytes) at 20, start code 9D 01 2A at 23, then 14-bit width / height.
    if (b.length < 30 || b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) {
      return null;
    }
    return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  }
  if (ascii(b, 12, "VP8L")) {
    // Signature 0x2F at 20, then (width - 1) and (height - 1) as two 14-bit fields.
    if (b.length < 25 || b[20] !== 0x2f) return null;
    const bits = (b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)) >>> 0;
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (ascii(b, 12, "VP8X")) {
    // Flags (4 bytes) at 20, then canvas (width - 1) and (height - 1) as u24 LE.
    if (b.length < 30) return null;
    return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
  }
  return null;
};

/** The width and height from the image header, or null when the header is unusable. */
export const readImageDimensions = (
  bytes: Uint8Array,
  format: ImageFormat,
): { width: number; height: number } | null => {
  const dims =
    format === "jpeg"
      ? jpegDimensions(bytes)
      : format === "png"
        ? pngDimensions(bytes)
        : format === "gif"
          ? gifDimensions(bytes)
          : webpDimensions(bytes);
  if (!dims || dims.width <= 0 || dims.height <= 0) return null;
  return dims;
};

/** The size guard, for a byte count known before the download (storage metadata). */
export const checkImageSize = (
  size: number,
): { ok: true } | { ok: false; reason: "too_large" } =>
  size > MAX_IMAGE_UPLOAD_BYTES
    ? { ok: false, reason: "too_large" }
    : { ok: true };

/** Every guard on the downloaded bytes: size, magic bytes, then the header's pixel count. */
export const checkImageBytes = (bytes: Uint8Array): ImageGuardResult => {
  const size = checkImageSize(bytes.length);
  if (!size.ok) return size;
  const format = sniffImageFormat(bytes);
  if (!format) return { ok: false, reason: "unsupported_format" };
  const dims = readImageDimensions(bytes, format);
  if (!dims) return { ok: false, reason: "unreadable_header" };
  if (dims.width * dims.height > MAX_IMAGE_PIXELS) {
    return { ok: false, reason: "too_many_pixels" };
  }
  return { ok: true, format, ...dims };
};
