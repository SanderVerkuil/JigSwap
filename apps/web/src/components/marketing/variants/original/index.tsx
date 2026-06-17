import { MarketingFooter } from "@/components/marketing/footer";
import { MarketingHeader } from "@/components/marketing/header";
import { FeatureRows } from "@/components/marketing/home/feature-rows";
import { FinalCTA } from "@/components/marketing/home/final-cta";
import { Hero } from "@/components/marketing/home/hero";
import { HowPreview } from "@/components/marketing/home/how-preview";
import { Stats } from "@/components/marketing/home/stats";
import { Sustain } from "@/components/marketing/home/sustain";
import { Testimonial } from "@/components/marketing/home/testimonial";

// The current production landing, kept intact as the "original" baseline so it
// can be compared side-by-side against the redesign variants.
export default function OriginalLanding() {
  return (
    <div className="mk-root font-mk-sans min-h-screen overflow-x-clip">
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
