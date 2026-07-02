import { gateway, Id } from "@/gateway";
import { useMutation, useQuery } from "convex/react";

// The member's favorited catalog definitions + an optimistic toggle. Every heart shares the one
// myFavoritePuzzleIds subscription (Convex dedupes identical query+args pairs), and the toggle
// patches that cached result locally so the heart flips instantly before the server confirms.
export function useFavorites() {
  const ids = useQuery(gateway.catalog.myFavoritePuzzleIds, {});
  const toggle = useMutation(
    gateway.catalog.toggleFavorite,
  ).withOptimisticUpdate((localStore, args) => {
    const current = localStore.getQuery(
      gateway.catalog.myFavoritePuzzleIds,
      {},
    );
    if (current === undefined) return;
    const next = current.includes(args.puzzleId)
      ? current.filter((id) => id !== args.puzzleId)
      : [...current, args.puzzleId];
    localStore.setQuery(gateway.catalog.myFavoritePuzzleIds, {}, next);
  });

  return {
    isLoading: ids === undefined,
    isFavorite: (puzzleId: string) =>
      (ids ?? []).includes(puzzleId as Id<"puzzles">),
    toggleFavorite: (puzzleId: string) =>
      toggle({ puzzleId: puzzleId as Id<"puzzles"> }),
  };
}
