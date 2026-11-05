import type { PuzzlePlankBox } from "@/components/common/puzzle-plank";
import { gateway } from "@/gateway";
import type { FunctionReturnType } from "convex/server";

// A single owned copy as returned by the profile shelf reads (featuredShelf and
// library.myShelf's `recent` both return the same OwnedCopyView shape).
export type ShelfCopy = FunctionReturnType<
  typeof gateway.social.featuredShelf
>[number];

// Flat street colours for a box without a cover, shared with the dashboard shelf, so neither shelf
// ever shows an empty gray box.
export const BOX_COLORS: ReadonlyArray<string> = [
  "#146350",
  "#a86400",
  "#2b7bb9",
  "#c8321f",
];

// Varied box heights so the shelf reads like a real, lived-in collection.
const BOX_HEIGHTS = [148, 130, 156, 126, 142];

// Map an owned copy onto a 3D plank box: prefer the copy's resolved cover (a
// user-uploaded/pinned photo) over the catalogue image so a copy with its own
// cover shows it, not placeholder art. Shared by the dashboard shelf section and
// the public member profile shelf.
export function toPlankBox(copy: ShelfCopy, index: number): PuzzlePlankBox {
  const cover = copy.coverUrl ?? copy.puzzle?.images?.[0];
  const color = BOX_COLORS[index % BOX_COLORS.length];
  return {
    title: copy.puzzle?.title ?? copy.snapshot?.title,
    series: copy.puzzle?.brand ?? copy.snapshot?.brand,
    pieceCount: copy.puzzle?.pieceCount ?? copy.snapshot?.pieceCount,
    cover,
    c1: color,
    c2: color,
    height: cover ? undefined : BOX_HEIGHTS[index % BOX_HEIGHTS.length],
  };
}
