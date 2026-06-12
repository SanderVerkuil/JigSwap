import { pageTitle } from "@/lib/page-title";
import { createFileRoute } from "@tanstack/react-router";

import { PuzzlesClient } from "@/components/puzzles/puzzle-client";

export const Route = createFileRoute("/_dashboard/puzzles/")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "puzzles") }],
  }),
  component: PuzzlesPage,
});

function PuzzlesPage() {
  return <PuzzlesClient />;
}
