import { createFileRoute } from "@tanstack/react-router";

import { PuzzleDetail } from "@/components/puzzles/puzzle-detail";

export const Route = createFileRoute("/_dashboard/puzzles/$id")({
  component: PuzzlePage,
});

function PuzzlePage() {
  const { id } = Route.useParams();
  return <PuzzleDetail puzzleId={id} />;
}
