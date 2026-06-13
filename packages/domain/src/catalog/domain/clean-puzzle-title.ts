// packages/domain/src/catalog/domain/clean-puzzle-title.ts

// Matches piece-count phrases (with optional thousands separators):
//   "1000 pieces", "1.000 stukjes", "500 pcs", "2000 Teile", etc.
const PIECE_PHRASE_RE =
  /(\d[\d.,\s]{0,7}\d|\d+)\s*(?:pieces?|pcs|stukjes|stukken|stuks|teile|piezas|pi[eè]ces)\b/gi;

// Generic puzzle/jigsaw noise tokens — whole-word, case-insensitive.
const NOISE_TOKEN_RE = /\b(?:puzzle|puzzel|legpuzzel|jigsaw|jigsawpuzzle)\b/gi;

// Individual descriptor words that, if they make up ALL words in a cleaned segment, cause
// the segment to be dropped. Checked word-by-word (not as a full segment regex) to handle
// multi-word combos like "Recycled cardboard" or "Gerecycled karton".
const DESCRIPTOR_WORD_RE =
  /^(?:karton|cardboard|recycled|gerecycled|hout|houten|wooden|volwassenen|adults|kinderen|children|\d+\+?\s*(?:jaar|years|yr))$/i;

// Separator patterns used to split the raw title into segments.
const SEGMENT_SPLIT_RE = / [-–—] | [|] | \/ /g;

/**
 * Returns true if every word in the segment is a material/audience descriptor.
 * An empty string returns false (handled separately).
 */
const isAllDescriptors = (seg: string): boolean => {
  const words = seg.split(/\s+/).filter(Boolean);
  return words.length > 0 && words.every((w) => DESCRIPTOR_WORD_RE.test(w));
};

/**
 * Cleans a raw puzzle title by:
 * 1. Splitting on common separators (` - `, `–`, `|`, ` / `).
 * 2. Removing piece-count phrases (number + unit word) from each segment.
 * 3. Removing generic noise tokens (puzzle, jigsaw, etc.) from each segment.
 * 4. Dropping any segment that is now empty or consists only of material/audience descriptors.
 * 5. Joining surviving segments with a space.
 * 6. Falling back to the trimmed raw input if everything was dropped.
 */
export const cleanPuzzleTitle = (
  raw: string,
  _opts: { brand?: string; pieceCount?: number } = {},
): string => {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;

  const segments = trimmed
    .split(SEGMENT_SPLIT_RE)
    .map((seg) => {
      // Remove piece-count phrases first (number + unit together).
      let cleaned = seg.replace(PIECE_PHRASE_RE, "");
      // Remove noise tokens.
      cleaned = cleaned.replace(NOISE_TOKEN_RE, "");
      // Collapse multiple spaces and trim.
      return cleaned.replace(/\s+/g, " ").trim();
    })
    .filter((seg) => {
      if (!seg) return false;
      // Drop if all remaining words are material or audience descriptors.
      return !isAllDescriptors(seg);
    });

  if (segments.length === 0) return trimmed;

  return segments.join(" ");
};
