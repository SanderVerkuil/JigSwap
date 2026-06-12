import { createFileRoute } from "@tanstack/react-router";

import { pageTitle } from "@/lib/page-title";

import { MarketingFooter } from "@/components/marketing/footer";
import { MarketingHeader } from "@/components/marketing/header";
import { FeatureRows } from "@/components/marketing/home/feature-rows";
import { FinalCTA } from "@/components/marketing/home/final-cta";
import { Hero } from "@/components/marketing/home/hero";
import { HowPreview } from "@/components/marketing/home/how-preview";
import { Stats } from "@/components/marketing/home/stats";
import { Sustain } from "@/components/marketing/home/sustain";
import { Testimonial } from "@/components/marketing/home/testimonial";

export const Route = createFileRoute("/")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "home") }],
  }),
  component: Home,
});

// Marketing landing — the design handoff's "plank" hero variant followed by
// stats (real platform numbers), how-it-works teaser, feature rows,
// sustainability band, founders' quote and the closing CTA.
function Home() {
  return (
    <div className="mk-root font-mk-sans min-h-screen">
      <MarketingHeader />
      <main>
        <Hero />
        <Stats />
        <HowPreview />
        <FeatureRows />
        <Sustain />
        <Testimonial />
        <FinalCTA />
      </main>
      <MarketingFooter />
    </div>
  );
}
