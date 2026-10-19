// Byte-level metadata stripping for uploaded images. Pure functions on byte buffers (no Convex
// ctx, no decoder), so they run in any runtime and are unit-tested on real fixture files.
//
// The walkers KEEP an allowlist of the blocks an image needs to display correctly and drop
// everything else, so an unknown or private block never slips through:
//
// - JPEG: keeps SOI, the frame/table/scan segments, the entropy-coded data, APP0 "JFIF", APP2
//   "ICC_PROFILE" (colour) and APP14 "Adobe" (CMYK/YCCK colour transform), up to EOI. Drops
//   APP1 (Exif, incl. GPS; XMP; extended XMP), APP13 (Photoshop IRB / IPTC), COM, every other
//   APPn (e.g. APP2 "MPF", which carries extra images with their own Exif), and anything after
//   EOI.
// - PNG: keeps the critical chunks and the ancillary chunks that change how the pixels look
//   (tRNS, gAMA, cHRM, sRGB, iCCP, sBIT, bKGD, pHYs, cICP, mDCV, cLLI, and the APNG chunks), up
//   to IEND. Drops eXIf, tEXt, iTXt (XMP lives here), zTXt, tIME and any other chunk.
// - WebP: keeps VP8/VP8L/VP8X/ALPH/ANIM/ANMF/ICCP and drops EXIF, "XMP " and any other chunk,
//   clearing the matching VP8X flags and rewriting the RIFF size.
//
// Orientation: a phone JPEG often stores its pixels sideways with an Exif Orientation tag that
// tells viewers how to turn them. Dropping it would show the photo sideways, and baking it in
// would need a decode + lossy re-encode, which is what this byte-level step avoids. So when the
// dropped Exif held an Orientation other than 1, the JPEG gets back a minimal Exif block with
// that one tag and nothing else (36 bytes: no GPS, no camera, no dates). Decoders that bake the
// orientation (browsers, jimp in the moderation pipeline) still turn the image upright. PNG and
// WebP orientation (eXIf / EXIF) is not kept: cameras do not write it there.
//
// A buffer whose block structure does not hold together (a block that runs past the end, a JPEG
// without SOS/EOI, a PNG that does not start with IHDR) is reported as malformed (null), never
// passed through: the caller refuses it.

export type StrippableFormat = "jpeg" | "png" | "webp";

/** A kind of metadata block found in an image (see `findMetadata`). */
export type MetadataKind =
  "exif" | "xmp" | "iptc" | "comment" | "text" | "time" | "other";

type Block = { bytes: Uint8Array; keep: boolean; kind?: MetadataKind };

type Walk = {
  blocks: Block[];
  /** JPEG: the Orientation (2..8) a dropped Exif block held, and where to put it back. */
  orientation?: { value: number; at: number };
};

const ascii = (bytes: Uint8Array, offset: number, text: string): boolean => {
  if (bytes.length < offset + text.length) return false;
  for (let i = 0; i < text.length; i++) {
    if (bytes[offset + i] !== text.charCodeAt(i)) return false;
  }
  return true;
};

const u16be = (b: Uint8Array, i: number): number => (b[i] << 8) | b[i + 1];
const u32be = (b: Uint8Array, i: number): number =>
  ((b[i] << 24) >>> 0) + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]);
const u32le = (b: Uint8Array, i: number): number =>
  (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

const concat = (parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

// ---- JPEG ---------------------------------------------------------------------------------

const EXIF_HEADER = "Exif\0\0";

/**
 * The IFD0 entries of an Exif APP1 payload (which starts with "Exif\0\0"), or null when the
 * TIFF structure is unusable. Each entry is [tag, type, count, value-or-offset bytes].
 */
const exifIfd0 = (
  payload: Uint8Array,
): {
  entries: { tag: number; type: number; value: number }[];
  next: number;
} | null => {
  if (!ascii(payload, 0, EXIF_HEADER)) return null;
  const tiff = payload.subarray(6);
  if (tiff.length < 8) return null;
  const little = ascii(tiff, 0, "II");
  if (!little && !ascii(tiff, 0, "MM")) return null;
  const u16 = (i: number) =>
    little ? tiff[i] | (tiff[i + 1] << 8) : u16be(tiff, i);
  const u32 = (i: number) => (little ? u32le(tiff, i) : u32be(tiff, i));
  if (u16(2) !== 42) return null;
  const ifd = u32(4);
  if (ifd + 2 > tiff.length) return null;
  const count = u16(ifd);
  if (ifd + 2 + count * 12 + 4 > tiff.length) return null;
  const entries = [];
  for (let n = 0; n < count; n++) {
    const at = ifd + 2 + n * 12;
    // A SHORT value sits in the first two bytes of the 4-byte value field.
    entries.push({ tag: u16(at), type: u16(at + 2), value: u16(at + 8) });
  }
  return { entries, next: u32(ifd + 2 + count * 12) };
};

const ORIENTATION_TAG = 0x0112;
const SHORT = 3;

/** The Orientation (2..8) an Exif APP1 payload holds, or null (absent, 1, or unusable). */
const exifOrientation = (payload: Uint8Array): number | null => {
  const ifd0 = exifIfd0(payload);
  const entry = ifd0?.entries.find((e) => e.tag === ORIENTATION_TAG);
  if (!entry || entry.type !== SHORT) return null;
  return entry.value >= 2 && entry.value <= 8 ? entry.value : null;
};

/** Whether an Exif APP1 payload holds nothing but an Orientation tag (what we write back). */
const isOrientationOnlyExif = (payload: Uint8Array): boolean => {
  const ifd0 = exifIfd0(payload);
  return (
    ifd0 !== null &&
    ifd0.next === 0 &&
    ifd0.entries.length === 1 &&
    ifd0.entries[0].tag === ORIENTATION_TAG
  );
};

/** A complete APP1 segment holding only the Orientation tag (big-endian TIFF, one IFD entry). */
// prettier-ignore
export const orientationOnlyApp1 = (orientation: number): Uint8Array =>
  new Uint8Array([
    0xff, 0xe1, 0x00, 0x22, // APP1, length 34
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // "Exif\0\0"
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // "MM", 42, IFD0 at 8
    0x00, 0x01, // one entry
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, // Orientation, SHORT, count 1
    0x00, orientation, 0x00, 0x00, // value
    0x00, 0x00, 0x00, 0x00, // no next IFD
  ]);

// Which marker segment to keep, and what a dropped one is.
const jpegSegment = (
  marker: number,
  payload: Uint8Array,
): { keep: true } | { keep: false; kind: MetadataKind } => {
  if (marker === 0xfe) return { keep: false, kind: "comment" };
  if (marker < 0xe0 || marker > 0xef) return { keep: true };
  if (marker === 0xe0 && ascii(payload, 0, "JFIF\0")) return { keep: true };
  if (marker === 0xe2 && ascii(payload, 0, "ICC_PROFILE\0"))
    return { keep: true };
  if (marker === 0xee && ascii(payload, 0, "Adobe")) return { keep: true };
  if (marker === 0xe1) {
    if (ascii(payload, 0, EXIF_HEADER)) return { keep: false, kind: "exif" };
    if (ascii(payload, 0, "http://ns.adobe.com/")) {
      return { keep: false, kind: "xmp" };
    }
  }
  if (marker === 0xed) return { keep: false, kind: "iptc" };
  return { keep: false, kind: "other" };
};

const walkJpeg = (b: Uint8Array): Walk | null => {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  const blocks: Block[] = [{ bytes: b.subarray(0, 2), keep: true }];
  let orientation: Walk["orientation"];
  // Where a kept Orientation goes: after SOI and a leading JFIF APP0 (which must come first).
  let insertAt = 1;
  let sawScan = false;
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff || i + 1 >= b.length) return null;
    const marker = b[i + 1];
    if (marker === 0xff) {
      i += 1; // fill byte
      continue;
    }
    if (marker === 0xd9) {
      // EOI: anything after it (trailers, appended files) is dropped.
      if (!sawScan) return null;
      blocks.push({ bytes: b.subarray(i, i + 2), keep: true });
      if (i + 2 < b.length) {
        blocks.push({ bytes: b.subarray(i + 2), keep: false, kind: "other" });
      }
      return { blocks, orientation };
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      blocks.push({ bytes: b.subarray(i, i + 2), keep: true });
      i += 2;
      continue;
    }
    if (i + 4 > b.length) return null;
    const length = u16be(b, i + 2);
    const end = i + 2 + length;
    if (length < 2 || end > b.length) return null;
    const payload = b.subarray(i + 4, end);
    const verdict = jpegSegment(marker, payload);
    if (verdict.keep) {
      blocks.push({ bytes: b.subarray(i, end), keep: true });
      if (marker === 0xe0 && insertAt === blocks.length - 1) {
        insertAt = blocks.length;
      }
    } else {
      // The minimal block we write back is not metadata worth reporting.
      const ours = verdict.kind === "exif" && isOrientationOnlyExif(payload);
      blocks.push({
        bytes: b.subarray(i, end),
        keep: false,
        kind: ours ? undefined : verdict.kind,
      });
      if (verdict.kind === "exif" && !orientation) {
        const value = exifOrientation(payload);
        if (value !== null) orientation = { value, at: insertAt };
      }
    }
    i = end;
    if (marker === 0xda) {
      // Entropy-coded data runs to the next marker that is not a stuffed 0xFF00 or a restart.
      sawScan = true;
      let j = i;
      while (j + 1 < b.length) {
        if (b[j] === 0xff) {
          const next = b[j + 1];
          if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
            j += 2;
            continue;
          }
          if (next !== 0xff) break;
        }
        j += 1;
      }
      if (j + 1 >= b.length) return null;
      blocks.push({ bytes: b.subarray(i, j), keep: true });
      i = j;
    }
  }
  return null; // no EOI
};

// ---- PNG ----------------------------------------------------------------------------------

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const PNG_KEEP = new Set([
  "IHDR",
  "PLTE",
  "IDAT",
  "IEND",
  "tRNS",
  "gAMA",
  "cHRM",
  "sRGB",
  "iCCP",
  "sBIT",
  "bKGD",
  "pHYs",
  "cICP",
  "mDCV",
  "cLLI",
  "acTL",
  "fcTL",
  "fdAT",
]);

const PNG_KIND: Record<string, MetadataKind> = {
  eXIf: "exif",
  tEXt: "text",
  zTXt: "text",
  iTXt: "text",
  tIME: "time",
};

const walkPng = (b: Uint8Array): Walk | null => {
  if (!PNG_SIGNATURE.every((byte, i) => b[i] === byte)) return null;
  if (!ascii(b, 12, "IHDR")) return null;
  const blocks: Block[] = [{ bytes: b.subarray(0, 8), keep: true }];
  let i = 8;
  while (i + 12 <= b.length) {
    const end = i + 12 + u32be(b, i);
    if (end > b.length) return null;
    const type = String.fromCharCode(...b.subarray(i + 4, i + 8));
    const keep = PNG_KEEP.has(type);
    blocks.push({
      bytes: b.subarray(i, end),
      keep,
      kind: keep ? undefined : (PNG_KIND[type] ?? "other"),
    });
    if (type === "IEND") {
      if (end < b.length) {
        blocks.push({ bytes: b.subarray(end), keep: false, kind: "other" });
      }
      return { blocks };
    }
    i = end;
  }
  return null; // no IEND
};

// ---- WebP ---------------------------------------------------------------------------------

const WEBP_KEEP = new Set([
  "VP8 ",
  "VP8L",
  "VP8X",
  "ALPH",
  "ANIM",
  "ANMF",
  "ICCP",
]);
// VP8X flag bits announcing the chunks we drop.
const VP8X_EXIF = 0x08;
const VP8X_XMP = 0x04;

const walkWebp = (b: Uint8Array): Walk | null => {
  if (!ascii(b, 0, "RIFF") || !ascii(b, 8, "WEBP")) return null;
  const blocks: Block[] = [];
  let i = 12;
  // Chunks are walked over the bytes actually there; a short tail is not a chunk.
  while (i + 8 <= b.length) {
    const size = u32le(b, i + 4);
    const end = i + 8 + size + (size & 1);
    if (i + 8 + size > b.length) return null;
    const type = String.fromCharCode(...b.subarray(i, i + 4));
    const bytes = b.subarray(i, Math.min(end, b.length));
    if (WEBP_KEEP.has(type)) {
      blocks.push({ bytes, keep: true });
    } else {
      const kind: MetadataKind =
        type === "EXIF" ? "exif" : type === "XMP " ? "xmp" : "other";
      blocks.push({ bytes, keep: false, kind });
    }
    i = end;
  }
  if (!blocks.some((block) => block.keep)) return null;
  return { blocks };
};

const assembleWebp = (walk: Walk): Uint8Array => {
  const kept = walk.blocks
    .filter((block) => block.keep)
    .map((block) => {
      if (!ascii(block.bytes, 0, "VP8X") || block.bytes.length < 9) {
        return block.bytes;
      }
      const copy = block.bytes.slice();
      copy[8] &= ~(VP8X_EXIF | VP8X_XMP);
      return copy;
    });
  const body = concat(kept);
  const header = new Uint8Array(12);
  header.set([0x52, 0x49, 0x46, 0x46]); // "RIFF"
  const size = 4 + body.length;
  header.set(
    [size & 0xff, (size >>> 8) & 0xff, (size >>> 16) & 0xff, size >>> 24],
    4,
  );
  header.set([0x57, 0x45, 0x42, 0x50], 8); // "WEBP"
  return concat([header, body]);
};

// ---- API ----------------------------------------------------------------------------------

const walk = (bytes: Uint8Array, format: StrippableFormat): Walk | null =>
  format === "jpeg"
    ? walkJpeg(bytes)
    : format === "png"
      ? walkPng(bytes)
      : walkWebp(bytes);

/**
 * The image without its metadata (see the header for what is kept), or null when the block
 * structure is malformed. A JPEG keeps a minimal Orientation-only Exif block when it had one.
 */
export const stripImageMetadata = (
  bytes: Uint8Array,
  format: StrippableFormat,
): Uint8Array | null => {
  const walked = walk(bytes, format);
  if (!walked) return null;
  if (format === "webp") return assembleWebp(walked);
  const kept = walked.blocks.filter((block) => block.keep).map((b) => b.bytes);
  if (walked.orientation) {
    kept.splice(
      walked.orientation.at,
      0,
      orientationOnlyApp1(walked.orientation.value),
    );
  }
  return concat(kept);
};

/**
 * The metadata blocks the image still carries (empty when clean), or null when its block
 * structure is malformed. The Orientation-only Exif block `stripImageMetadata` writes back is
 * not counted.
 */
export const findMetadata = (
  bytes: Uint8Array,
  format: StrippableFormat,
): MetadataKind[] | null => {
  const walked = walk(bytes, format);
  if (!walked) return null;
  return walked.blocks.flatMap((block) =>
    !block.keep && block.kind ? [block.kind] : [],
  );
};
