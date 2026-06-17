import { Link } from "@/compat/link";
import { type PlankBox } from "@/components/marketing/plank";
import { JigPlank3D } from "@/components/marketing/plank-3d";
import { Reveal } from "@/components/marketing/reveal";
import { Eyebrow } from "@/components/marketing/section";
import { useStartHref } from "@/components/marketing/use-start-href";
import type { LandingData } from "@/components/marketing/variants/use-landing-data";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import * as React from "react";
import { useFormatter } from "use-intl";
import { AvatarCluster } from "./avatar-cluster";
import { useDraggablePiece } from "./draggable-piece";

// Round-robin colours for the dialed-back plank fallback boxes.
const COLOR_PAIRS: Array<[string, string]> = [
  ["var(--mk-violet-400)", "var(--mk-violet-600)"],
  ["var(--mk-green-400)", "var(--mk-green-600)"],
  ["var(--mk-pink-400)", "var(--mk-pink-500)"],
  ["var(--mk-violet-300)", "var(--mk-violet-700)"],
];
const WIDTHS = [100, 116, 96, 108, 90, 104] as const;

// Calm Dutch placeholder boxes used while the live catalog loads or is sparse.
const FALLBACK_BOXES: PlankBox[] = [
  { series: "Natuur", title: "Boslicht", pieceCount: 1000 },
  { series: "Steden", title: "Amsterdam", pieceCount: 1500 },
  { series: "Kunst", title: "De Nachtwacht", pieceCount: 2000 },
  { series: "Natuur", title: "Waddenzee", pieceCount: 500 },
  { series: "Steden", title: "Utrecht", pieceCount: 750 },
  { series: "Kunst", title: "Delfts Blauw", pieceCount: 1000 },
].map((b, i) => {
  const [c1, c2] = COLOR_PAIRS[i % COLOR_PAIRS.length];
  return { ...b, c1, c2, width: WIDTHS[i % WIDTHS.length] };
});

// Two soft shelf rows for the calmer supporting prop.
const SHELF_ROWS = 2;
function toRows(boxes: PlankBox[]): PlankBox[][] {
  const rows: PlankBox[][] = Array.from({ length: SHELF_ROWS }, () => []);
  boxes.forEach((b, i) => rows[i % SHELF_ROWS].push(b));
  return rows;
}

export function Hero({ data }: { data: LandingData }) {
  const { stats, communityAvatars, plankPuzzles } = data;
  const startHref = useStartHref();
  const format = useFormatter();

  // One-time visual stat tick driven by the delight moment. Never mutates real
  // data — it's a +1 flourish layered on top of the live value.
  const [bumped, setBumped] = React.useState(false);
  const piece = useDraggablePiece(() => setBumped(true));

  const rows = React.useMemo(() => {
    const boxes: PlankBox[] =
      plankPuzzles && plankPuzzles.length >= 3
        ? plankPuzzles.map((p, i) => {
            const [c1, c2] = COLOR_PAIRS[i % COLOR_PAIRS.length];
            return {
              title: p.title,
              pieceCount: p.pieceCount,
              series: p.brand,
              cover: p.image ?? undefined,
              width: WIDTHS[i % WIDTHS.length],
              c1,
              c2,
            };
          })
        : FALLBACK_BOXES;
    return toRows(boxes);
  }, [plankPuzzles]);

  const liveCount =
    stats != null ? format.number(stats.totalUsers + (bumped ? 1 : 0)) : null;

  return (
    <div className="relative overflow-x-clip">
      <div className="v-glow" aria-hidden="true" />

      <div className="relative z-[1] w-full max-w-[1200px] mx-auto px-6">
        <div className="grid items-center gap-[clamp(32px,5vw,72px)] pt-[clamp(48px,7vw,96px)] pb-[clamp(56px,8vw,104px)] min-[861px]:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
          {/* Left column — text lockup */}
          <Reveal>
            <div className="max-w-[620px]">
              <Eyebrow>The friendly home for your puzzles</Eyebrow>

              <h1 className="font-mk-heading font-bold text-mk-text-strong mt-4 text-[clamp(30px,5.2vw,56px)] leading-[1.05] tracking-[-0.01em] text-balance">
                Your {piece.notch}, but make them social.
              </h1>

              {/* Tray + caption + success toast live under the headline so the
                  h1 text flow stays clean. */}
              {piece.tray}

              <p className="mt-[clamp(18px,2.2vw,28px)] text-[clamp(16px,1.4vw,19px)] leading-relaxed text-mk-text-muted max-w-[520px] text-pretty">
                Shelve every box, lend to fellow puzzlers, and always see
                who&apos;s got it. Free to start.
              </p>

              {/* CTA row */}
              <div className="mt-[clamp(20px,2.4vw,32px)] flex flex-wrap gap-3 max-[860px]:flex-col">
                <Button
                  variant="brand"
                  className="h-11 px-6 text-[15px] max-[860px]:w-full"
                  asChild
                >
                  <Link href={startHref}>
                    Start your shelf
                    <ArrowRight size={17} />
                  </Link>
                </Button>
                <Button
                  variant="outline"
                  className="h-11 px-6 text-[15px] bg-mk-card border-mk-border text-mk-text-strong hover:bg-mk-muted max-[860px]:w-full"
                  asChild
                >
                  <Link href="/how-it-works">See how it works</Link>
                </Button>
              </div>

              {/* Live trust row */}
              <div className="mt-[clamp(22px,2.6vw,32px)] flex items-center gap-3.5 flex-wrap">
                <AvatarCluster avatars={communityAvatars} />
                <div className="text-[14.5px] text-mk-text-muted leading-snug">
                  {liveCount != null ? (
                    <>
                      <span className="font-semibold text-mk-text-strong tabular-nums">
                        {liveCount}
                      </span>{" "}
                      puzzlers are already swapping
                    </>
                  ) : (
                    "Join the community"
                  )}
                </div>
              </div>
            </div>
          </Reveal>

          {/* Right column — dialed-back plank supporting prop */}
          <div
            aria-hidden="true"
            className="relative justify-self-center max-[860px]:order-last max-[540px]:hidden"
            style={{
              width: "clamp(280px, 34vw, 440px)",
              height: "clamp(280px, 34vw, 440px)",
            }}
          >
            {/* low-intensity radial behind the plank */}
            <div
              className="absolute inset-[-12%] rounded-full"
              style={{
                background:
                  "radial-gradient(closest-side, var(--v-glow-violet), transparent 72%)",
                filter: "blur(6px)",
              }}
            />
            <div className="absolute inset-0">
              <JigPlank3D rows={rows} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
