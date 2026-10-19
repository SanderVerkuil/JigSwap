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
// Orientation: a phone photo often stores its pixels sideways with an Exif Orientation tag that
// tells viewers how to turn them (JPEG APP1; PNG eXIf and WebP EXIF can carry it too). Every
// Exif block is dropped, so `stripImageMetadata` also returns the Orientation (1..8) the
// dropped Exif held: a caller that stores the result must turn the pixels upright itself
// (lib/imageModeration/normaliseImage), or the image shows sideways.
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
  /** The Orientation (2..8) a dropped Exif block held (the first one that holds one). */
  orientation?: number;
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

// ---- Exif ---------------------------------------------------------------------------------

const EXIF_HEADER = "Exif\0\0";
const ORIENTATION_TAG = 0x0112;
const SHORT = 3;

/**
 * The Orientation (2..8) an Exif payload holds in IFD0, or null (absent, 1, or unusable). The
 * payload is a TIFF structure, optionally behind an "Exif\0\0" header (always there in a JPEG
 * APP1; PNG eXIf and WebP EXIF normally start at the TIFF header).
 */
const exifOrientation = (payload: Uint8Array): number | null => {
  const tiff = ascii(payload, 0, EXIF_HEADER) ? payload.subarray(6) : payload;
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
  if (ifd + 2 + count * 12 > tiff.length) return null;
  for (let n = 0; n < count; n++) {
    const at = ifd + 2 + n * 12;
    if (u16(at) !== ORIENTATION_TAG) continue;
    // A SHORT value sits in the first two bytes of the 4-byte value field.
    const value = u16(at + 8);
    return u16(at + 2) === SHORT && value >= 2 && value <= 8 ? value : null;
  }
  return null;
};

// ---- JPEG ---------------------------------------------------------------------------------

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
  let orientation: number | undefined;
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
    } else {
      blocks.push({
        bytes: b.subarray(i, end),
        keep: false,
        kind: verdict.kind,
      });
      if (verdict.kind === "exif" && orientation === undefined) {
        orientation = exifOrientation(payload) ?? undefined;
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
  let orientation: number | undefined;
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
    if (type === "eXIf" && orientation === undefined) {
      orientation = exifOrientation(b.subarray(i + 8, end - 4)) ?? undefined;
    }
    if (type === "IEND") {
      if (end < b.length) {
        blocks.push({ bytes: b.subarray(end), keep: false, kind: "other" });
      }
      return { blocks, orientation };
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
  let orientation: number | undefined;
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
      if (kind === "exif" && orientation === undefined) {
        orientation =
          exifOrientation(b.subarray(i + 8, i + 8 + size)) ?? undefined;
      }
    }
    i = end;
  }
  if (!blocks.some((block) => block.keep)) return null;
  return { blocks, orientation };
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

/** An image without its metadata, and the Orientation its dropped Exif held. */
export type StrippedImage = {
  bytes: Uint8Array;
  /** 1 (as stored) when there was none; 2..8 when the pixels still need turning upright. */
  orientation: number;
};

/**
 * The image without its metadata (see the header for what is kept) and the Orientation the
 * dropped Exif held, or null when the block structure is malformed. The bytes carry no Exif at
 * all, so a caller must apply an Orientation of 2..8 to the pixels before storing them.
 */
export const stripImageMetadata = (
  bytes: Uint8Array,
  format: StrippableFormat,
): StrippedImage | null => {
  const walked = walk(bytes, format);
  if (!walked) return null;
  const stripped =
    format === "webp"
      ? assembleWebp(walked)
      : concat(walked.blocks.filter((block) => block.keep).map((b) => b.bytes));
  return { bytes: stripped, orientation: walked.orientation ?? 1 };
};

/**
 * The metadata blocks the image still carries (empty when clean), or null when its block
 * structure is malformed.
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

/**
 * A JPEG's APP2 "ICC_PROFILE" segments (marker included, in order), for copying onto an RGB
 * re-encode of it; empty when it has none, the profile is not an RGB one (CMYK, grey), or the
 * JPEG is malformed.
 */
export const jpegIccSegments = (bytes: Uint8Array): Uint8Array[] => {
  const segments = (walkJpeg(bytes)?.blocks ?? [])
    .map((block) => block.bytes)
    .filter((seg) => seg[1] === 0xe2 && ascii(seg, 4, "ICC_PROFILE\0"));
  // The profile header's colour space sits 16 bytes into the profile, which starts after the
  // marker, length, "ICC_PROFILE\0" and the sequence/count bytes of the first segment.
  const first = segments.find((seg) => seg[16] === 1);
  return first && ascii(first, 4 + 14 + 16, "RGB ") ? segments : [];
};
