import { pageTitle } from "@/lib/page-title";
import { createFileRoute } from "@tanstack/react-router";

import { GroupLanding } from "@/components/dashboard-layout/group-landing";

export const Route = createFileRoute("/_dashboard/library")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "library") }],
  }),
  component: LibraryLandingPage,
});

// "My Library" landing: the directory of everything-you-own-and-track
// surfaces. Reached from the sidebar group label and the breadcrumb group
// crumb; the page title/subtitle render in the shell page head.
function LibraryLandingPage() {
  return <GroupLanding group="library" />;
}
