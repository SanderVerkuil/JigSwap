// Scrape-time heuristic for the URL-import pipeline: hasUnsupportedImageExtension lets buildImages
// skip candidates the import action is guaranteed to reject (extensions we KNOW fail;
// extension-less URLs pass — the action stays authoritative, and checks the bytes itself).

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
