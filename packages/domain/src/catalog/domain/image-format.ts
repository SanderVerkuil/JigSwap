// Image-format knowledge shared by the URL-import pipeline. The import action accepts only the
// raster formats it can safely store (jpeg/png/webp/gif/avif — SVG is a stored-XSS vector and
// stays banned). Two pure helpers keep both ends of the pipeline honest:
// - hasUnsupportedImageExtension: scrape-time heuristic so buildImages never offers a candidate
//   the action is guaranteed to reject (extensions we KNOW fail; extension-less URLs pass —
//   the action stays authoritative).
// - sniffImageType: magic-byte detection so a supported image served with a wrong/missing
//   content-type (CDNs love application/octet-stream) is still importable, without ever
//   trusting a header to smuggle in SVG/HTML.

const UNSUPPORTED_IMAGE_EXTENSIONS = new Set([
  "svg",
  "ico",
  "bmp",
  "tif",
  "tiff",
  "heic",
  "heif",
  "pdf",
]);

export const hasUnsupportedImageExtension = (url: string): boolean => {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return false; // unparseable — later guards (URL validation in the action) own it
  }
  const lastSegment = pathname.split("/").pop() ?? "";
  const dot = lastSegment.lastIndexOf(".");
  if (dot === -1) return false;
  return UNSUPPORTED_IMAGE_EXTENSIONS.has(
    lastSegment.slice(dot + 1).toLowerCase(),
  );
};

export type SniffedImageType =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/gif"
  | "image/avif";

const ascii = (bytes: Uint8Array, start: number, text: string): boolean => {
  if (bytes.length < start + text.length) return false;
  for (let i = 0; i < text.length; i++) {
    if (bytes[start + i] !== text.charCodeAt(i)) return false;
  }
  return true;
};

export const sniffImageType = (bytes: Uint8Array): SniffedImageType | null => {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (bytes.length >= 4 && bytes[0] === 0x89 && ascii(bytes, 1, "PNG")) {
    return "image/png";
  }
  if (ascii(bytes, 0, "GIF8")) {
    return "image/gif";
  }
  if (ascii(bytes, 0, "RIFF") && ascii(bytes, 8, "WEBP")) {
    return "image/webp";
  }
  // ISO-BMFF: "ftyp" at offset 4, AVIF brands "avif"/"avis" at offset 8.
  if (
    ascii(bytes, 4, "ftyp") &&
    (ascii(bytes, 8, "avif") || ascii(bytes, 8, "avis"))
  ) {
    return "image/avif";
  }
  return null;
};
