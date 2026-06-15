import { createFileRoute } from "@tanstack/react-router";

import { pageTitle } from "@/lib/page-title";
import { CopyInstanceScreen } from "@/routes/_dashboard/copies/$id";

// The owner's view of their own copy. Same screen as /copies/$id but framed as
// "My Library › My Puzzles › <name>" and gated: CopyInstanceScreen redirects to
// the public /copies/$id when the viewer does not own this copy.
export const Route = createFileRoute("/_dashboard/my-puzzles/$id")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "myPuzzles") }],
  }),
  component: MyCopyPage,
});

function MyCopyPage() {
  const { id } = Route.useParams();
  return <CopyInstanceScreen copyId={id} owned />;
}
