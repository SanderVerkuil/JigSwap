import type { PuzzlePlankBox } from "@/components/common/puzzle-plank";
import { gateway } from "@/gateway";
import type { FunctionReturnType } from "convex/server";

// A single owned copy as returned by the profile shelf reads (featuredShelf and
// library.ownedByOwner both return the same OwnedCopyView shape).
export type ShelfCopy = FunctionReturnType<
  typeof gateway.social.featuredShelf
>[number];

// Same warm gradient fallbacks as the dashboard shelf — never an empty gray box.
const BOX_GRADIENTS: ReadonlyArray<readonly [string, string]> = [
  ["#6048e8", "#494e92"],
  ["#3fae3c", "#157a13"],
  ["#ec4899", "#b22d6e"],
  ["#f5a623", "#cf7911"],
];

// Varied box heights so the shelf reads like a real, lived-in collection.
const BOX_HEIGHTS = [148, 130, 156, 126, 142];

// Map an owned copy onto a 3D plank box: prefer the copy's resolved cover (a
// user-uploaded/pinned photo) over the catalogue image so a copy with its own
// cover shows it, not placeholder art. Shared by the dashboard shelf section and
// the public member profile shelf.
export function toPlankBox(copy: ShelfCopy, index: number): PuzzlePlankBox {
  const cover =
    copy.coverUrl ?? copy.puzzle?.images?.[0] ?? copy.snapshot?.thumbnail;
  const [c1, c2] = BOX_GRADIENTS[index % BOX_GRADIENTS.length];
  return {
    title: copy.puzzle?.title ?? copy.snapshot?.title,
    series: copy.puzzle?.brand ?? copy.snapshot?.brand,
    pieceCount: copy.puzzle?.pieceCount ?? copy.snapshot?.pieceCount,
    cover,
    c1,
    c2,
    height: cover ? undefined : BOX_HEIGHTS[index % BOX_HEIGHTS.length],
  };
}
