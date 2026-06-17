import { MarketingFooter } from "@/components/marketing/footer";
import { MarketingHeader } from "@/components/marketing/header";
import { useLandingData } from "@/components/marketing/variants/use-landing-data";
import "./playful.css";

import { CustodySpotlight } from "./custody-spotlight";
import { FinalCta } from "./final-cta";
import { Founders } from "./founders";
import { Hero } from "./hero";
import { HowSteps } from "./how-steps";
import { StatPills } from "./stat-pills";
import { SustainBand } from "./sustain-band";

// Variant 1 — "Playful-Premium". Friendly puzzle-piece personality on a clean,
// whitespace-rich structure, spending its entire "delight budget" on a single
// draggable-piece moment in the hero. The page re-skins purely via the
// `.v-playful` scope in playful.css; every component still reads `--mk-*`.
export default function PlayfulLanding() {
  // Single source of truth for real platform numbers / avatars / shelf covers.
  const data = useLandingData({ avatarLimit: 4, plankLimit: 12 });

  return (
    <div className="v-playful font-mk-sans min-h-screen overflow-x-clip">
      <MarketingHeader />
      <main>
        <Hero data={data} />
        <StatPills data={data} />
        <HowSteps />
        <CustodySpotlight />
        <SustainBand />
        <Founders data={data} />
        <FinalCta />
      </main>
      <MarketingFooter />
    </div>
  );
}
