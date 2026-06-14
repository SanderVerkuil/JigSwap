// packages/domain/src/catalog/domain/extract-puzzle-draft.ts
import { cleanPuzzleTitle } from "./clean-puzzle-title";
import type {
  JsonLdProduct,
  PuzzleImportDraft,
  RawProductPage,
} from "./puzzle-import-draft";

// Multilingual piece-count: EN pieces/pcs, NL stukjes, DE Teile, ES piezas, FR pieces. Captures
// an integer that may carry `.`/`,`/space thousands separators (e.g. "1.000", "1,500").
const PIECE_COUNT_RE =
  /(\d[\d.,\s]{0,7}\d|\d)\s*(?:pieces?|pcs|stukjes|teile|piezas|pi[eè]ces)\b/i;

const parsePieceCount = (text: string): number | undefined => {
  const match = text.match(PIECE_COUNT_RE);
  if (!match) return undefined;
  const n = Number.parseInt(match[1].replace(/[.,\s]/g, ""), 10);
  return Number.isFinite(n) && n >= 1 && n <= 100000 ? n : undefined;
};

const toImageArray = (
  image: string | readonly string[] | undefined,
): readonly string[] => {
  // Stryker disable next-line ConditionalExpression,ArrayDeclaration: defensive guard against
  // null/undefined image fields in untrusted JSON-LD. Equivalent under the downstream filter in
  // buildImages (typeof === "string" + HTTP_RE), which discards any null/sentinel that leaks past.
  if (image == null) return [];
  return Array.isArray(image)
    ? (image as readonly string[])
    : [image as string];
};

const MAX_IMAGES = 8;
const HTTP_RE = /^https?:\/\//;

const buildImages = (raw: RawProductPage): readonly string[] => {
  const product = raw.jsonLdProducts[0];
  const candidates = [...toImageArray(product?.image), ...raw.ogImages];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const url of candidates) {
    if (
      // Stryker disable next-line ConditionalExpression: runtime guard against non-string image
      // entries in untrusted JSON-LD. Equivalent under the static string[] type, but real defense.
      typeof url === "string" &&
      HTTP_RE.test(url) &&
      !seen.has(url) &&
      result.length < MAX_IMAGES
    ) {
      seen.add(url);
      result.push(url);
    }
  }
  return result;
};

const barcodes = (
  product: JsonLdProduct | undefined,
): { ean?: string; upc?: string } => {
  const gtin13 =
    product?.gtin13 ??
    (product?.gtin?.length === 13 ? product.gtin : undefined);
  const gtin12 =
    product?.gtin12 ??
    (product?.gtin?.length === 12 ? product.gtin : undefined);
  return { ean: gtin13, upc: gtin12 };
};

const clean = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

// Tiered, in order: JSON-LD Product -> OpenGraph -> <title>/<meta>. Piece count regex runs over
// title + description. Title is "" when no tier yields one; the caller decides if that is usable.
export const extractPuzzleDraft = (
  raw: RawProductPage,
  sourceUrl: string,
): PuzzleImportDraft => {
  const product = raw.jsonLdProducts[0];
  // Compute rawTitle BEFORE cleaning — pieceCount is parsed from it. No outer trim is needed:
  // parsePieceCount tolerates surrounding whitespace and cleanPuzzleTitle trims internally.
  const rawTitle = product?.name ?? raw.ogTitle ?? raw.basicTitle ?? "";
  const description = clean(
    product?.description ?? raw.ogDescription ?? raw.basicDescription,
  );
  const { ean, upc } = barcodes(product);
  const brand = clean(product?.brand);
  // Parse piece count from the ORIGINAL title + description so cleaning doesn't lose the count.
  // Stryker disable next-line StringLiteral: the "" fallback only applies when description is
  // absent; any replacement string is whitespace/word-only and carries no digit+unit token, so it
  // cannot change the parsed piece count — an equivalent mutant.
  const pieceCount = parsePieceCount(`${rawTitle} ${description ?? ""}`);
  // Clean title AFTER deriving pieceCount (cleaning may strip the count phrase).
  const title = cleanPuzzleTitle(rawTitle);

  // Build deduplicated image list: JSON-LD product images first, then OG images.
  const images = buildImages(raw);

  return {
    title,
    brand,
    imageUrl: images[0],
    images,
    description,
    ean,
    upc,
    pieceCount,
    sourceUrl,
  };
};
