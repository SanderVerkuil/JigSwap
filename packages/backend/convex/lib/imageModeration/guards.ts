// Input guards for uploaded images, run by the moderation pipeline BEFORE anything decodes the
// bytes. Pure functions on byte buffers (no Convex ctx, no jimp), so they are unit-tested directly.
//
// - Size: the stored blob is at most MAX_IMAGE_UPLOAD_BYTES (checked from the storage metadata
//   before the download, and again on the downloaded bytes).
// - Type: the magic bytes say JPEG, PNG, WebP or GIF. Anything else (SVG, HTML, PDF, BMP, TIFF,
//   HEIC, ...) is refused, whatever content type the client claimed.
// - Pixels: the width x height read from the header is at most MAX_IMAGE_PIXELS, so a tiny file
//   that would decompress to a huge bitmap (a decompression bomb) is refused before decode.
//   That only holds when the decoder reads the same size from the same bytes, so a header a
//   decoder could read differently is refused too, and the decode itself checks the bitmap it
//   got against the header (normaliseImage.decodeUpright).
//
// Memory: a Node action has 512 MiB, and a decode that runs past it kills the attempt before
// anything is refused, so the upload is retried and crashes again. MAX_IMAGE_PIXELS and
// MAX_JPEG_BLOCKS come from measuring the pipeline's decode, re-encode and blurhash (Node 26,
// jimp 1.6.1, 2026-10-30) as the smallest cgroup (no swap) each image completes in:
//   JPEG 4:2:0 4032x3024 (285,768 blocks)  373 MiB   the largest accepted; 8 MP 268, 14 MP 436
//   JPEG 4:2:0 5000x5000                   OOM-killed at 512 MiB, now refused
//   JPEG 4:4:4 4032x3024 (571,536 blocks)  611 MiB   now refused; 4:4:4 2880x2160: 324 MiB
//   JPEG CMYK 3264x2448                    499 MiB   now refused; CMYK 2488x1872: 317 MiB
//   JPEG of 779 bytes, 1x65535, 255 components sampled 15x15: 1.4 GiB, now refused
//   JPEG of 111 bytes, CMYK 64x65535 sampled 4x4 (262,144 blocks): 331 MiB
//   PNG RGBA 16-bit 4032x3024 324 MiB; WebP lossless 4032x3024 338 MiB; GIF 4032x3024 184 MiB
// jpeg-js's memory follows its blocks (about 800 bytes each), not the pixels, so a JPEG is
// bounded by both. A deployed action carries more than this measurement, hence the headroom.
//
// JPEG: jpeg-js (jimp's decoder) allocates the blocks of every frame header it meets, as many as
// the components and their sampling ask for, whatever the pixel count. A JPEG is accepted only
// when the bytes the decoder is given (jpegDecodeInput: without APPn and COM segments) hold
// exactly one frame header, of 1 to 4 components sampled 1..4, whose blocks fit MAX_JPEG_BLOCKS.
// jpeg-js's own caps (maxResolutionInMP, maxMemoryUsageInMB: JPEG_DECODER_MEMORY_MB) back that
// up in decodeUpright.
//
// PNG: pngjs (jimp's decoder) takes the size from EVERY IHDR it meets, so the last one decides
// the bitmap, and it inflates an interlaced (Adam7) image with no bound on the output. A PNG is
// accepted only with exactly one IHDR, as its first chunk, and not interlaced ("interlaced");
// the non-interlaced inflate is bounded by that IHDR's size. An APNG (an acTL chunk) is refused
// ("animated"): jimp has no APNG decoder, and its frames are not what a still decode shows.
//
// WebP: libwebp (the WASM decoder, normaliseImage) decodes one still image, the VP8 (lossy) or
// VP8L (lossless) bitstream that is the first chunk or, behind a VP8X (extended) header, the
// first one after it. A WebP is accepted only as such a still: an animation (the VP8X animation
// flag, or an ANIM or ANMF chunk anywhere) is refused ("animated"), and behind a VP8X header the
// bitstream must be exactly the canvas size, so the size checked is the size decoded.
// jimp 1.x has no WebP codec, so the pipeline decodes every WebP with the WASM decoder
// (normaliseImage) and re-encodes it like JPEG/PNG (JPEG, or PNG when it has transparency, with
// a blurhash): a WebP is never stored as the container it was uploaded in.
// WebP stays accepted because phones and browsers hand it over and the web client may upload the
// original when it cannot re-encode in the browser.
//
// GIF: jimp decodes the first frame into a bitmap of the logical screen size (omggif), so the
// screen size bounds the decode, and the first frame must fit inside the screen; the re-encode
// keeps that one frame, so an animated GIF is stored (and classified) as its first frame. The
// blocks before that frame are walked exactly as omggif walks them, so the frame checked is the
// frame it decodes; a block omggif would read differently, or refuse, is refused here.

/** Largest accepted upload, in bytes (10 MB). */
export const MAX_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Largest accepted image, in pixels: 12.2 MP, a 4032 x 3024 phone photo (see the header). */
export const MAX_IMAGE_PIXELS = 12_200_000;

/**
 * Most 8x8 blocks jpeg-js may allocate for a JPEG's frame (see jpegHeader): what a 4:2:0 photo
 * of MAX_IMAGE_PIXELS needs (285,768 for 4032 x 3024), with room for MCU padding. A 4:4:4 JPEG
 * fits up to about 6.2 MP, a CMYK one up to about 4.6 MP.
 */
export const MAX_JPEG_BLOCKS = 292_000;

/**
 * jpeg-js's own cap on what it allocates (its `maxMemoryUsageInMB`, which counts MiB), a backstop
 * behind the frame check: for the largest frame the guards accept, its blocks as jpeg-js counts
 * them (256 bytes each) and their sample lines (64 bytes per block), its colour and RGBA pixels
 * (8 bytes per pixel), plus 10 MiB for tables.
 */
export const JPEG_DECODER_MEMORY_MB =
  Math.ceil(
    (MAX_JPEG_BLOCKS * (256 + 64) + MAX_IMAGE_PIXELS * 8) / (1024 * 1024),
  ) + 10;

export type ImageFormat = "jpeg" | "png" | "webp" | "gif";

/** Why an upload was refused. Stored as the row's `moderationReason`. */
export type ImageGuardFailure =
  | "too_large" // more than MAX_IMAGE_UPLOAD_BYTES
  | "unsupported_format" // the magic bytes are not JPEG / PNG / WebP / GIF
  | "unreadable_header" // a supported format whose header has no usable dimensions
  | "too_many_pixels" // more than MAX_IMAGE_PIXELS, or (JPEG) more than MAX_JPEG_BLOCKS
  | "interlaced" // an interlaced (Adam7) PNG, whose decode has no output bound
  | "animated" // an animated WebP or an APNG: only a still image is decoded
  | "decode_failed"; // a header over a body that does not decode (set by the pipeline)

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
const u32le = (b: Uint8Array, i: number): number =>
  (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * What a header says about the decode: its size, (PNG) whether it is interlaced, (PNG, WebP)
 * whether it is an animation, and (JPEG) the 8x8 blocks the decoder allocates for it.
 */
type Header = {
  width: number;
  height: number;
  interlaced?: boolean;
  animated?: boolean;
  jpegBlocks?: number;
};

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

/**
 * The bytes the JPEG decoder is given: the image without its APPn and COM segments, except
 * APP14 "Adobe" (it says how to convert the colours). None of the others changes a pixel, and
 * an Exif thumbnail or an ICC profile may hold bytes that read as a frame header. Walked by the
 * segment lengths up to EOI (anything after it is dropped) or to where the structure stops
 * holding together (the rest is dropped too, and the decode fails).
 */
export const jpegDecodeInput = (b: Uint8Array): Uint8Array => {
  const parts = [b.subarray(0, 2)];
  let i = 2;
  while (i + 1 < b.length && b[i] === 0xff) {
    const marker = b[i + 1];
    if (marker === 0xff) {
      i += 1; // fill byte
      continue;
    }
    if (marker === 0xd9) {
      parts.push(b.subarray(i, i + 2));
      break;
    }
    // Stand-alone markers carry no length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      parts.push(b.subarray(i, i + 2));
      i += 2;
      continue;
    }
    if (i + 4 > b.length) break;
    const end = i + 2 + u16be(b, i + 2);
    if (end < i + 4 || end > b.length) break;
    const app = (marker >= 0xe0 && marker <= 0xef) || marker === 0xfe;
    if (!app || (marker === 0xee && ascii(b, i + 4, "Adobe"))) {
      parts.push(b.subarray(i, end));
    }
    i = end;
    if (marker === 0xda) {
      // Entropy-coded data runs to the next marker that is not a stuffed 0xFF00 or a restart.
      let j = i;
      while (j + 1 < b.length) {
        const next = b[j + 1];
        if (b[j] === 0xff && next !== 0x00 && next !== 0xff) {
          if (next < 0xd0 || next > 0xd7) break;
        }
        j += 1;
      }
      if (j + 1 >= b.length) j = b.length;
      parts.push(b.subarray(i, j));
      i = j;
    }
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

// JPEG: jpeg-js (jimp's decoder) allocates its 8x8 blocks (an Int32Array(64) each, about 800
// bytes in V8) the moment it meets a frame header, SOF0, SOF1 or SOF2 (the only ones it
// decodes), for every one it meets, and checks there was only one at the very end. How many
// depends on the components and their sampling, not on the pixel count: a 1 x 65535 header with
// 255 components sampled 15x15 allocates over 1 GiB. So in the bytes the decoder is given
// (jpegDecodeInput) the two bytes of a frame header (FF C0..C2) must occur exactly once, at any
// offset (wherever the decoder's own walk could take it), and that frame header must hold
// together: 1 to 4 components (what jpeg-js turns into pixels), each sampled 1..4 (the JPEG
// standard's range). Its block count is what jpeg-js allocates for it: per component, its
// sampled blocks in every MCU, the image padded to whole MCUs.
const jpegHeader = (b: Uint8Array): Header | null => {
  const input = jpegDecodeInput(b);
  let at = -1;
  for (let i = 0; i + 1 < input.length; i++) {
    if (input[i] === 0xff && input[i + 1] >= 0xc0 && input[i + 1] <= 0xc2) {
      if (at !== -1) return null;
      at = i;
    }
  }
  // [marker][length u16][precision][height u16][width u16][n], then n x [id][h << 4 | v][table].
  if (at === -1 || at + 10 > input.length) return null;
  const components = input[at + 9];
  if (components < 1 || components > 4) return null;
  if (u16be(input, at + 2) !== 8 + 3 * components) return null;
  if (at + 10 + 3 * components > input.length) return null;
  const sampling: { h: number; v: number }[] = [];
  for (let c = 0; c < components; c++) {
    const hv = input[at + 11 + 3 * c];
    const h = hv >> 4;
    const v = hv & 0x0f;
    if (h < 1 || h > 4 || v < 1 || v > 4) return null;
    sampling.push({ h, v });
  }
  const height = u16be(input, at + 5);
  const width = u16be(input, at + 7);
  const maxH = Math.max(...sampling.map((s) => s.h));
  const maxV = Math.max(...sampling.map((s) => s.v));
  const mcusPerLine = Math.ceil(width / 8 / maxH);
  const mcusPerColumn = Math.ceil(height / 8 / maxV);
  const jpegBlocks = sampling.reduce(
    (sum, { h, v }) => sum + mcusPerLine * h * mcusPerColumn * v,
    0,
  );
  return { width, height, jpegBlocks };
};

// PNG: the chunk list, walked by its lengths up to IEND (pngjs refuses anything after it), must
// hold exactly one IHDR, and it must be the first chunk, 13 bytes long: width u32, height u32,
// bit depth, colour type, compression, filter, interlace method. A chunk that runs past the end
// of the file ends the walk (pngjs cannot read past it either). An acTL chunk makes it an APNG.
const pngHeader = (b: Uint8Array): Header | null => {
  if (b.length < 8 + 8 + 13) return null;
  if (u32be(b, 8) !== 13 || !ascii(b, 12, "IHDR")) return null;
  let animated = false;
  let i = 8 + 12 + 13;
  while (i + 8 <= b.length) {
    if (ascii(b, i + 4, "IHDR")) return null;
    if (ascii(b, i + 4, "IEND")) break;
    if (ascii(b, i + 4, "acTL")) animated = true;
    i += 12 + u32be(b, i);
  }
  return {
    width: u32be(b, 16),
    height: u32be(b, 20),
    interlaced: b[28] !== 0,
    animated,
  };
};

// GIF: the logical screen descriptor right after the 6-byte signature (u16 LE each), checked
// together with the FIRST image descriptor, which is the frame jimp decodes: it must lie inside
// the logical screen (and so within the pixel budget the screen is checked against).
// The blocks before it are walked the way omggif (jimp's decoder) walks them, which is not
// simply by their size-prefixed sub-blocks: it reads a graphic control extension (F9) as exactly
// one 4-byte sub-block and its terminator, and throws on any label other than F9, FE (comment)
// and FF (application). An application extension whose first sub-block is not its 11-byte
// identifier it skips by a fixed 17 bytes, whatever the sub-blocks say: walked by their sizes
// instead, a crafted file shows a 1x1 frame here and a 65535x16384 one to omggif (SEC-18). So
// a GIF is accepted only with blocks both walks read alike: a graphic control extension of
// exactly that shape, comments, and application extensions that open with the identifier.
// The first frame's data must end inside the file. No image descriptor => no usable header.
const gifDimensions = (
  b: Uint8Array,
): { width: number; height: number } | null => {
  if (b.length < 13) return null;
  const screen = { width: u16le(b, 6), height: u16le(b, 8) };
  // Size-prefixed sub-blocks from `at` up to their 0 terminator: the index after it, or null
  // when they run past the end.
  const subBlocksEnd = (at: number): number | null => {
    let i = at;
    while (i < b.length && b[i] !== 0) i += b[i] + 1;
    return i < b.length ? i + 1 : null;
  };
  // A colour table: 3 * 2^(n+1) bytes when the flag bit is set.
  const colourTable = (flags: number) =>
    flags & 0x80 ? 3 * (1 << ((flags & 0x07) + 1)) : 0;
  let i = 13 + colourTable(b[10]);
  while (i < b.length) {
    const block = b[i];
    if (block === 0x2c) {
      // Image descriptor: left, top, width, height (u16 LE each), flags; then the local colour
      // table, the LZW minimum code size and the data sub-blocks.
      if (i + 10 > b.length) return null;
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
      const data = i + 10 + colourTable(b[i + 9]);
      if (data >= b.length || subBlocksEnd(data + 1) === null) return null;
      return screen;
    }
    if (block !== 0x21) return null; // trailer (0x3B) or garbage before any frame
    const label = b[i + 1];
    i += 2;
    if (label === 0xf9) {
      if (b[i] !== 4 || b[i + 5] !== 0) return null;
      i += 6;
      continue;
    }
    if (label !== 0xfe && !(label === 0xff && b[i] === 0x0b)) return null;
    const end = subBlocksEnd(i);
    if (end === null) return null;
    i = end;
  }
  return null;
};

/** The VP8X flag bit that marks an animation. */
const VP8X_ANIMATION = 0x02;

// The size a VP8 (lossy) or VP8L (lossless) bitstream chunk starting at `at` announces.
const webpBitstreamSize = (
  b: Uint8Array,
  at: number,
): { width: number; height: number } | null => {
  const data = at + 8;
  if (ascii(b, at, "VP8 ")) {
    // Frame tag (3 bytes), start code 9D 01 2A, then 14-bit width / height.
    if (
      b.length < data + 10 ||
      b[data + 3] !== 0x9d ||
      b[data + 4] !== 0x01 ||
      b[data + 5] !== 0x2a
    ) {
      return null;
    }
    return {
      width: u16le(b, data + 6) & 0x3fff,
      height: u16le(b, data + 8) & 0x3fff,
    };
  }
  if (ascii(b, at, "VP8L")) {
    // Signature 0x2F, then (width - 1) and (height - 1) as two 14-bit fields.
    if (b.length < data + 5 || b[data] !== 0x2f) return null;
    const bits = u32le(b, data + 1);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  return null;
};

// WebP: the chunks after "RIFF....WEBP", walked by their sizes (padded to even) over the bytes
// there, so the walk sees every chunk libwebp's own walk could reach. The first is VP8 (lossy) or
// VP8L (lossless), a simple still, or VP8X (extended): flags, 3 reserved bytes, then the canvas
// (width - 1) and (height - 1) as u24 LE, 10 bytes in all, followed by optional chunks (ICCP,
// ALPH, ...) and the bitstream libwebp decodes, the first VP8 or VP8L chunk, which must be the
// canvas size. The VP8X animation flag or an ANIM or ANMF chunk anywhere makes it an animation.
const webpHeader = (b: Uint8Array): Header | null => {
  const chunks: number[] = [];
  for (let i = 12; i + 8 <= b.length;) {
    chunks.push(i);
    const size = u32le(b, i + 4);
    i += 8 + size + (size & 1);
  }
  if (chunks.length === 0) return null;
  const animated = chunks.some(
    (at) => ascii(b, at, "ANIM") || ascii(b, at, "ANMF"),
  );
  const [first] = chunks;
  if (!ascii(b, first, "VP8X")) {
    const size = webpBitstreamSize(b, first);
    return size && { ...size, animated };
  }
  if (u32le(b, first + 4) !== 10 || b.length < first + 18) return null;
  const canvas = {
    width: u24le(b, first + 12) + 1,
    height: u24le(b, first + 15) + 1,
  };
  if (animated || b[first + 8] & VP8X_ANIMATION) {
    return { ...canvas, animated: true };
  }
  const bitstream = chunks.find(
    (at) => ascii(b, at, "VP8 ") || ascii(b, at, "VP8L"),
  );
  const size = bitstream === undefined ? null : webpBitstreamSize(b, bitstream);
  if (!size || size.width !== canvas.width || size.height !== canvas.height) {
    return null;
  }
  return canvas;
};

const readHeader = (bytes: Uint8Array, format: ImageFormat): Header | null => {
  const header =
    format === "jpeg"
      ? jpegHeader(bytes)
      : format === "png"
        ? pngHeader(bytes)
        : format === "gif"
          ? gifDimensions(bytes)
          : webpHeader(bytes);
  if (!header || header.width <= 0 || header.height <= 0) return null;
  return header;
};

/** The width and height from the image header, or null when the header is unusable. */
export const readImageDimensions = (
  bytes: Uint8Array,
  format: ImageFormat,
): { width: number; height: number } | null => {
  const header = readHeader(bytes, format);
  return header && { width: header.width, height: header.height };
};

/** The size guard, for a byte count known before the download (storage metadata). */
export const checkImageSize = (
  size: number,
): { ok: true } | { ok: false; reason: "too_large" } =>
  size > MAX_IMAGE_UPLOAD_BYTES
    ? { ok: false, reason: "too_large" }
    : { ok: true };

/**
 * Every guard on the downloaded bytes: size, magic bytes, then the header: its pixel count,
 * (JPEG) the blocks its frame makes the decoder allocate, (PNG) no interlacing, and (PNG, WebP)
 * one still image, no animation.
 */
export const checkImageBytes = (bytes: Uint8Array): ImageGuardResult => {
  const size = checkImageSize(bytes.length);
  if (!size.ok) return size;
  const format = sniffImageFormat(bytes);
  if (!format) return { ok: false, reason: "unsupported_format" };
  const header = readHeader(bytes, format);
  if (!header) return { ok: false, reason: "unreadable_header" };
  const { width, height } = header;
  if (
    width * height > MAX_IMAGE_PIXELS ||
    (header.jpegBlocks ?? 0) > MAX_JPEG_BLOCKS
  ) {
    return { ok: false, reason: "too_many_pixels" };
  }
  if (header.interlaced) return { ok: false, reason: "interlaced" };
  if (header.animated) return { ok: false, reason: "animated" };
  return { ok: true, format, width, height };
};
