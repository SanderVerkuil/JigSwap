import { MAIN_CONTENT_ID } from "@/components/a11y/skip-link";
import { MarketingFooter } from "@/components/marketing/footer";
import { MarketingHeader } from "@/components/marketing/header";
import { FeatureRows } from "@/components/marketing/home/feature-rows";
import { FinalCTA } from "@/components/marketing/home/final-cta";
import { Hero } from "@/components/marketing/home/hero";
import { HowPreview } from "@/components/marketing/home/how-preview";
import { Stats } from "@/components/marketing/home/stats";
import { Sustain } from "@/components/marketing/home/sustain";
import { shouldRedirectHomeToDashboard } from "@/lib/home-redirect";
import { globalStatsQuery } from "@/lib/marketing-queries";
import { seoHead } from "@/lib/seo-head";
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  // A signed-in visitor entering the site here lands on their dashboard. On the
  // server this is the document load (root beforeLoad has resolved Clerk's
  // userId), so the redirect is an HTTP one with no flash of the landing page;
  // client-side navigation to / never redirects.
  beforeLoad: ({ context }) => {
    if (
      shouldRedirectHomeToDashboard({
        userId: context.userId,
        isDocumentLoad: typeof window === "undefined",
      })
    ) {
      throw redirect({ to: "/dashboard" });
    }
  },
  head: ({ match }) => seoHead(match, "home"),
  // Prefetch the platform counts (hero count line + the figures sentence) so they're SSR'd and present on
  // first paint rather than flashing in after a client round-trip.
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(globalStatsQuery);
  },
  component: Home,
});

// The street with the fronts off, as an argument: see the shelves, how a box moves, what you can do,
// the real figures, a letter from the family, and the invitation. The opaque main slides up to uncover
// the footer behind it.
function Home() {
  return (
    <div className="mk-root font-mk-sans min-h-svh overflow-x-clip">
      <MarketingHeader hideActionNearHero />
      <main id={MAIN_CONTENT_ID} className="relative z-10 bg-mk-bg">
        <Hero />
        <HowPreview />
        <FeatureRows />
        <Stats />
        <Sustain />
        <FinalCTA />
      </main>
      <MarketingFooter curtain />
    </div>
  );
}
