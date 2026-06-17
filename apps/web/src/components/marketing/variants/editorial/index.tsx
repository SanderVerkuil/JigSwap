import { useLandingData } from "@/components/marketing/variants/use-landing-data";

import { ClosingCover } from "./closing-cover";
import { CustodySpread } from "./custody-spread";
import "./editorial.css";
import { FiguresBand } from "./figures-band";
import { EditorialFooter } from "./footer";
import { FoundersLetter } from "./founders-letter";
import { EditorialHeader } from "./header";
import { HeroCover } from "./hero-cover";
import { LoopSpreads } from "./loop-spreads";
import { Manifesto } from "./manifesto";
import { Paper } from "./paper";

// Bold / Editorial landing — a design-magazine cover for a puzzle community.
// Type-led, asymmetric magazine grid; ink-on-paper with one editorial accent.
// Single data fetch shared across the page; one <header> / <main> / <footer>
// landmark set, one <h1> (in the hero). Reuses Reveal/Container/Button/etc.;
// the plank reuses JigPlank3D (lazy + WebGL/reduced-motion gated internally).
export default function EditorialLanding() {
  // One Convex read for the whole page (stats + avatars + plank puzzles).
  const data = useLandingData({ plankLimit: 12, avatarLimit: 4 });

  return (
    <div className="v-editorial font-mk-sans min-h-screen overflow-x-clip bg-mk-bg text-mk-text-body">
      <EditorialHeader />
      <Paper as="div" className="bg-mk-bg">
        <main>
          <HeroCover data={data} />
          <FiguresBand data={data} />
          <Manifesto />
          <LoopSpreads />
          <CustodySpread />
          <FoundersLetter />
          <ClosingCover />
        </main>
      </Paper>
      <EditorialFooter data={data} />
    </div>
  );
}
