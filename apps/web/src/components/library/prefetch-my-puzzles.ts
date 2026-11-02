import { gateway } from "@/gateway";
import { convexQuery } from "@convex-dev/react-query";
import type { QueryClient } from "@tanstack/react-query";
import {
  filtersFromSearch,
  viewNeedsWholeLibrary,
  type MyPuzzlesSearch,
} from "./my-puzzles-filters";
import { LIBRARY_PAGE_SIZE } from "./use-library-rows";

// My Puzzles' reads during SSR, with the very arguments the page asks for. Only a plain list: a
// search, sort or status pill is worked out in the browser over the lean index, which is the whole
// library and doesn't belong in a page's HTML.
export async function prefetchMyPuzzles(
  queryClient: QueryClient,
  search: MyPuzzlesSearch,
): Promise<void> {
  const filters = filtersFromSearch(search);
  await Promise.allSettled([
    queryClient.fetchQuery(convexQuery(gateway.identity.currentUser, {})),
    queryClient.fetchQuery(convexQuery(gateway.household.mine, {})),
    queryClient.fetchQuery(convexQuery(gateway.lending.lentOut, {})),
    queryClient.fetchQuery(convexQuery(gateway.solving.mySolveStates, {})),
    // The cards mark box art still being checked.
    queryClient.fetchQuery(
      convexQuery(gateway.catalog.listMyBoxArtInCheck, {}),
    ),
    ...(viewNeedsWholeLibrary(filters)
      ? []
      : [
          queryClient.fetchQuery(
            convexQuery(gateway.library.myLibraryWindow, {
              owner: filters.owner,
              limit: LIBRARY_PAGE_SIZE,
            }),
          ),
        ]),
  ]);
}
