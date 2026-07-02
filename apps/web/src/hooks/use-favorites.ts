import { gateway, Id } from "@/gateway";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";

// The member's favorited catalog definitions + an optimistic toggle. Every heart shares the one
// myFavoritePuzzleIds subscription (Convex dedupes identical query+args pairs), and the toggle
// patches that cached result locally so the heart flips instantly before the server confirms.
// The optimistic patch lands in the Convex local store; the tanstack-query bridge's watch on
// this query mirrors localQueryResult() into the QueryClient, so the heart still flips instantly.
export function useFavorites() {
  const { data: ids, isPending } = useQuery(
    convexQuery(gateway.catalog.myFavoritePuzzleIds, {}),
  );
  const { mutateAsync: toggle } = useMutation({
    mutationFn: useConvexMutation(
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
    }),
  });

  return {
    isLoading: isPending,
    isFavorite: (puzzleId: string) =>
      (ids ?? []).includes(puzzleId as Id<"puzzles">),
    toggleFavorite: (puzzleId: string) =>
      toggle({ puzzleId: puzzleId as Id<"puzzles"> }),
  };
}
