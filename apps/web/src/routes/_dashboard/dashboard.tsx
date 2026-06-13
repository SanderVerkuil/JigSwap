import { pageTitle } from "@/lib/page-title";
import { createFileRoute } from "@tanstack/react-router";

import { BriefingHero } from "@/components/dashboard-home/briefing-hero";
import { FreshSection } from "@/components/dashboard-home/fresh-section";
import { PulseSection } from "@/components/dashboard-home/pulse-section";
import { ShelfSection } from "@/components/dashboard-home/shelf-section";

// The (dashboard) landing (URL: /dashboard): the editorial "morning briefing".
// Narrative headline → pending-request banner + quick actions → the shelf with
// its numbers rail → the three-column pulse (In Motion / Goals / Latest) →
// the fresh-puzzles scroller. Card-free, whitespace-separated blocks; the
// shell chrome owns the page title, so there is no h1 here.
export const Route = createFileRoute("/_dashboard/dashboard")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "dashboard") }],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  return (
    <div className="flex w-full flex-col gap-8 md:gap-10">
      <BriefingHero />
      <ShelfSection />
      <PulseSection />
      <FreshSection />
    </div>
  );
}
