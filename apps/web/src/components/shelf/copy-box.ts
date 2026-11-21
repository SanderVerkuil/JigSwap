import type { ShelfBox } from "./box-face";

// What a shelf needs from a copy, as the library and profile reads return it (OwnedCopyView).
export interface ShelfCopy {
  _id: string;
  coverUrl?: string | null;
  puzzle?: {
    title: string;
    brand?: string;
    pieceCount: number;
    images?: string[];
  } | null;
  snapshot?: { title: string; brand?: string; pieceCount: number };
}

/**
 * A copy as a box on a shelf, opening at `href`: the member's own copy at /my-puzzles/<id>, anyone
 * else's at /copies/<id>. The copy's resolved cover (an uploaded and approved photo, else the
 * catalogue's art) comes before the puzzle's own image. Pure.
 */
export function copyShelfBox(copy: ShelfCopy, href: string): ShelfBox {
  return {
    id: copy._id,
    title: copy.puzzle?.title ?? copy.snapshot?.title ?? "",
    brand: copy.puzzle?.brand ?? copy.snapshot?.brand,
    pieceCount: copy.puzzle?.pieceCount ?? copy.snapshot?.pieceCount,
    cover: copy.coverUrl ?? copy.puzzle?.images?.[0] ?? undefined,
    href,
  };
}
