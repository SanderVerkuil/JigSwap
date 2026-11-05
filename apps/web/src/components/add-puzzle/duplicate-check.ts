// Pure helpers for the contribute form's "is this already in the catalogue?" check.
import { catalogueSearchKey, detectBarcode } from "@/lib/catalogue-search";

const MIN_TITLE_LENGTH = 3;
const MAX_TITLE_MATCHES = 3;

/**
 * The lookups to run for what the member has typed: a catalogue title search once the title has
 * three characters (on the normalised search key), and a barcode lookup once the EAN, else the UPC,
 * is barcode-shaped.
 */
export function duplicateLookups(fields: {
  title: string;
  ean: string;
  upc: string;
}): { titleTerm: string | null; barcode: string | null } {
  const titleTerm = catalogueSearchKey(fields.title);
  return {
    titleTerm: titleTerm.length >= MIN_TITLE_LENGTH ? titleTerm : null,
    barcode: detectBarcode(fields.ean) ?? detectBarcode(fields.upc),
  };
}

const words = (title: string) =>
  title
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/**
 * Whether a catalogue title plausibly names the puzzle being typed: one title holds every word of
 * the other (case and accents ignored), the last typed word counting as a prefix because it may
 * still be half typed. The catalogue search matches on any shared word, so this keeps "Sunset over
 * the lake" from being offered "The Lake House" as the same puzzle.
 */
export function titlesOverlap(typed: string, candidate: string): boolean {
  const mine = words(typed);
  const theirs = words(candidate);
  if (!mine.length || !theirs.length) return false;
  const last = mine.length - 1;
  const typedInCandidate = mine.every((word, i) =>
    i === last ? theirs.some((w) => w.startsWith(word)) : theirs.includes(word),
  );
  return typedInCandidate || theirs.every((w) => mine.includes(w));
}

/**
 * The existing puzzles to offer: the barcode match (an exact hit), and up to three title matches
 * that overlap the searched title. Puzzles the member said are different are left out, and the
 * barcode match is not repeated among the title matches.
 */
export function duplicateCandidates<T extends { _id: string; title: string }>({
  titleTerm,
  titleMatches,
  barcodeMatch,
  dismissed,
}: {
  titleTerm: string | null;
  titleMatches: ReadonlyArray<T> | undefined;
  barcodeMatch: T | null | undefined;
  dismissed: ReadonlySet<string>;
}): { byBarcode: T | null; byTitle: T[] } {
  const byBarcode =
    barcodeMatch && !dismissed.has(barcodeMatch._id) ? barcodeMatch : null;
  const byTitle = titleTerm
    ? (titleMatches ?? [])
        .filter(
          (p) =>
            !dismissed.has(p._id) &&
            p._id !== barcodeMatch?._id &&
            titlesOverlap(titleTerm, p.title),
        )
        .slice(0, MAX_TITLE_MATCHES)
    : [];
  return { byBarcode, byTitle };
}
