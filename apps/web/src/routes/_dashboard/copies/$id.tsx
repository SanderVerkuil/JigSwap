import { CopyInstanceScreen } from "@/components/copies/copy-instance-screen";
import { parseNavContext } from "@/components/dashboard-layout/nav-context";
import { pageTitle } from "@/lib/page-title";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_dashboard/copies/$id")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "copyInstance") }],
  }),
  // The page reads ?from off the URL — a typed navigation-context param set by
  // links that want contextual breadcrumbs (e.g. a collection's puzzle grid).
  // Unknown/malformed values parse to null downstream and the page falls back
  // to its canonical breadcrumb trail.
  validateSearch: (search: Record<string, unknown>): { from?: string } => ({
    from: typeof search.from === "string" ? search.from : undefined,
  }),
  component: CopyInstancePage,
});

function CopyInstancePage() {
  const { id } = Route.useParams();
  const { from } = Route.useSearch();
  return (
    <CopyInstanceScreen
      copyId={id}
      owned={false}
      navContext={parseNavContext(from)}
    />
  );
}
