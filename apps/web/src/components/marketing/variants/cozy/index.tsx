import "./cozy.css";

import { MarketingFooter } from "@/components/marketing/footer";
import { MarketingHeader } from "@/components/marketing/header";
import { useLandingData } from "@/components/marketing/variants/use-landing-data";
import { FeelVignettes } from "./feel-vignettes";
import { FinalCta } from "./final-cta";
import { FoundersNote } from "./founders-note";
import { CozyHero } from "./hero";
import { MomentStrip } from "./moment-strip";
import { SecondLife } from "./second-life";

// Cozy / Hygge landing — "a warm little corner for your puzzles and the people
// you share them with." Warm cream surfaces, terracotta/sage/honey re-seed, a
// humanist soft-serif display (Fraunces), gentle grain + warm photo-fallbacks.
//
// The 3D plank is intentionally CUT (it's cool/techy and fights hygge — also
// keeps Three.js out of this variant's bundle). No real lifestyle photos exist,
// so every photographic slot ships as a deliberate CSS gradient + grain
// fallback; cover-sand.webp anchors exactly one duotone hero corner.
export default function CozyLanding() {
  // Single data source — never re-fetch Convex directly. Plank is cut, so we
  // ignore plankPuzzles (request 0). Real stats power the humanized count.
  const { stats, communityAvatars } = useLandingData({
    avatarLimit: 4,
    plankLimit: 0,
  });

  return (
    <div className="v-cozy font-mk-sans min-h-screen overflow-x-clip">
      <MarketingHeader />
      <main>
        <CozyHero stats={stats} />
        <MomentStrip stats={stats} avatars={communityAvatars} />
        <FeelVignettes />
        <SecondLife />
        <FoundersNote />
        <FinalCta />
      </main>
      <MarketingFooter />
    </div>
  );
}
