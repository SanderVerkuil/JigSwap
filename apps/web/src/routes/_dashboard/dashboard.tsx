import { BriefingHero } from "@/components/dashboard-home/briefing-hero";
import { FreshSection } from "@/components/dashboard-home/fresh-section";
import { PulseSection } from "@/components/dashboard-home/pulse-section";
import { ShelfSection } from "@/components/dashboard-home/shelf-section";
import { SolvingNowSection } from "@/components/dashboard-home/solving-now-section";
import { QuickSetupCard } from "@/components/quick-start/quick-setup-card";
import { WelcomeDialog } from "@/components/quick-start/welcome-dialog";
import { ConnectionOffersStrip } from "@/components/social/connection-offers";
import { pageTitle } from "@/lib/page-title";
import { createFileRoute } from "@tanstack/react-router";

// The (dashboard) landing (URL: /dashboard): the editorial "morning briefing".
// Narrative headline → pending-request banner + quick actions → the shelf with
// its numbers rail → the in-progress solving rail → the three-column pulse
// (In Motion / Goals / Latest) → the fresh-puzzles scroller. A new member also gets the
// one-time quick start welcome dialog, any open connection offer from whoever invited them, and,
// above the shelf, the quick setup checklist. Card-free, whitespace-separated blocks; the shell
// chrome owns the page title, so there is no h1 here. The pulse columns switch on this page's own
// width (the `dashboard` container), not the viewport: the content column is 256px narrower
// whenever the sidebar is docked, so a tablet with the icon rail gets the columns a 1024px window
// with the docked sidebar has always had. The shelf stays on the viewport `lg` breakpoint: beside
// the stats its 3D plank would be cropped on a tablet (UX-17).
export const Route = createFileRoute("/_dashboard/dashboard")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "dashboard") }],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  return (
    <div className="@container/dashboard flex w-full flex-col gap-6 md:gap-10">
      <WelcomeDialog />
      <BriefingHero />
      <ConnectionOffersStrip />
      <QuickSetupCard />
      <ShelfSection />
      <SolvingNowSection />
      <PulseSection />
      <FreshSection />
    </div>
  );
}
