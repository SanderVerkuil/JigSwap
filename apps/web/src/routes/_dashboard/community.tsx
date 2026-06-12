import { pageTitle } from "@/lib/page-title";
import { createFileRoute } from "@tanstack/react-router";

import { GroupLanding } from "@/components/dashboard-layout/group-landing";

export const Route = createFileRoute("/_dashboard/community")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "community") }],
  }),
  component: CommunityLandingPage,
});

// "Community" landing: the directory of discover/swap/connect surfaces.
// The page's previous social-hub content (profile editor, follow lists,
// activity feed) now lives at /people.
function CommunityLandingPage() {
  return <GroupLanding group="community" />;
}
