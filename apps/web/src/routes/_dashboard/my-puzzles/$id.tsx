import { parseNavContext } from "@/components/dashboard-layout/nav-context";
import { pageTitle } from "@/lib/page-title";
import { CopyInstanceScreen } from "@/routes/_dashboard/copies/$id";
import { createFileRoute } from "@tanstack/react-router";

// The owner's view of their own copy. Same screen as /copies/$id but framed as
// "My Library › My Puzzles › <name>" and gated: CopyInstanceScreen redirects to
// the public /copies/$id when the viewer does not own this copy.
export const Route = createFileRoute("/_dashboard/my-puzzles/$id")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "myPuzzles") }],
  }),
  // Like /copies/$id: a `?from=collection:<id>` link (an owner's collection card) frames the
  // copy under that collection's breadcrumbs instead; absent/malformed falls back to the above.
  validateSearch: (search: Record<string, unknown>): { from?: string } => ({
    from: typeof search.from === "string" ? search.from : undefined,
  }),
  component: MyCopyPage,
});

function MyCopyPage() {
  const { id } = Route.useParams();
  const { from } = Route.useSearch();
  return (
    <CopyInstanceScreen copyId={id} owned navContext={parseNavContext(from)} />
  );
}
