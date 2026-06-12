import { pageTitle } from "@/lib/page-title";
import { createFileRoute } from "@tanstack/react-router";

import { PuzzleDetail } from "@/components/puzzles/puzzle-detail";

export const Route = createFileRoute("/_dashboard/puzzles/$id")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "puzzle") }],
  }),
  component: PuzzlePage,
});

function PuzzlePage() {
  const { id } = Route.useParams();
  return <PuzzleDetail puzzleId={id} />;
}
