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

const firstImage = (
  image: string | readonly string[] | undefined,
): string | undefined =>
  Array.isArray(image) ? image[0] : (image as string | undefined);

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
  // Compute rawTitle BEFORE cleaning — pieceCount is parsed from it.
  const rawTitle = (
    product?.name ??
    raw.ogTitle ??
    raw.basicTitle ??
    ""
  ).trim();
  const description = clean(
    product?.description ?? raw.ogDescription ?? raw.basicDescription,
  );
  const { ean, upc } = barcodes(product);
  const brand = clean(product?.brand);
  // Parse piece count from the ORIGINAL title + description so cleaning doesn't lose the count.
  const pieceCount = parsePieceCount(`${rawTitle} ${description ?? ""}`);
  // Clean title AFTER deriving pieceCount (cleaning may strip the count phrase).
  const title = cleanPuzzleTitle(rawTitle, { brand, pieceCount });

  return {
    title,
    brand,
    imageUrl: firstImage(product?.image) ?? raw.ogImages[0],
    description,
    ean,
    upc,
    pieceCount,
    sourceUrl,
  };
};
