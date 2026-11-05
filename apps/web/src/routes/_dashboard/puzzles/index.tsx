import { PuzzlesClient } from "@/components/puzzles/puzzle-client";
import { pageTitle } from "@/lib/page-title";
import {
  validatePuzzlesSearch,
  type PuzzlesSearch,
} from "@/lib/puzzles-search";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_dashboard/puzzles/")({
  // Term, filters, favourites and view mode live in the URL (see lib/puzzles-search), so Back from
  // a puzzle comes back to the same results and a filtered catalogue is a shareable link.
  validateSearch: validatePuzzlesSearch,
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "puzzles") }],
  }),
  component: PuzzlesPage,
});

function PuzzlesPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <PuzzlesClient
      search={search}
      onSearchChange={(update: (prev: PuzzlesSearch) => PuzzlesSearch) =>
        void navigate({
          search: update,
          // Narrowing the catalogue is a change of view, not a new page: no history entry, and
          // the scroll position stays.
          replace: true,
          resetScroll: false,
        })
      }
    />
  );
}
