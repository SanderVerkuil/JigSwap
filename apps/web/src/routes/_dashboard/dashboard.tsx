import { BriefingHero } from "@/components/dashboard-home/briefing-hero";
import { FreshSection } from "@/components/dashboard-home/fresh-section";
import { PulseSection } from "@/components/dashboard-home/pulse-section";
import { ShelfSection } from "@/components/dashboard-home/shelf-section";
import { SolvingNowSection } from "@/components/dashboard-home/solving-now-section";
import { usePageHeaderActions } from "@/components/dashboard-layout/page-header-slot";
import { QuickSetupCard } from "@/components/quick-start/quick-setup-card";
import { ConnectionOffersStrip } from "@/components/social/connection-offers";
import { GuideHelpButton } from "@/components/tour/guide-help-button";
import { useTourLauncher } from "@/components/whats-new/tour-launcher";
import { useIsMobile } from "@/hooks/use-mobile";
import { pageTitle } from "@/lib/page-title";
import { loadMemberDataOnServer } from "@/lib/ssr-member-data";
import { createFileRoute } from "@tanstack/react-router";

// The (dashboard) landing (URL: /dashboard): the editorial "morning briefing".
// Narrative headline → pending-request banner + quick actions → the shelf with
// its numbers rail → the in-progress solving rail → the three-column pulse
// (In Motion / Goals / Latest) → the fresh-puzzles scroller. A new member also gets any open
// connection offer from whoever invited them and, above the shelf, the quick setup checklist (the
// one-time welcome dialog lives in the _dashboard layout). Card-free, whitespace-separated
// blocks; the shell chrome owns the page title, so there is no h1 here. The pulse columns switch
// on this page's own width (the `dashboard` container), not the viewport: the content column is
// 256px narrower whenever the sidebar is docked, so a tablet with the icon rail gets the columns a
// 1024px window with the docked sidebar has always had. The shelf stays on the viewport `lg`
// breakpoint: beside the stats its 3D plank would be cropped on a tablet (UX-17).
export const Route = createFileRoute("/_dashboard/dashboard")({
  // Imported on demand so the browser never downloads it: a route's loader isn't code-split, so a
  // static import here would put the sections it shares constants with on every public page.
  loader: ({ context }) =>
    loadMemberDataOnServer(context, async () => {
      const { prefetchDashboardHome } =
        await import("@/components/dashboard-home/prefetch-dashboard-home");
      await prefetchDashboardHome(context.queryClient);
    }),
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "dashboard") }],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  // The page head's "?" starts the getting-started tour, whose first steps are on this page, for
  // any member and not just one who still has the Quick setup card (UX-91). Not on phones: there
  // it would sit alone in a row above the headline, and the + sheet's Help & guides and the
  // card's Show me around already offer the tour.
  const { startTour } = useTourLauncher();
  const isMobile = useIsMobile();
  usePageHeaderActions(
    () =>
      isMobile ? null : (
        <GuideHelpButton tourId="getting-started" startTour={startTour} />
      ),
    [isMobile, startTour],
  );
  return (
    <div className="@container/dashboard flex w-full flex-col gap-6 md:gap-10">
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
