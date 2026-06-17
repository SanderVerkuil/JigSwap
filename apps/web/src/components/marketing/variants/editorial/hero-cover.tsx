import { Link } from "@/compat/link";
import { JigPlank3D } from "@/components/marketing/plank-3d";
import { Reveal } from "@/components/marketing/reveal";
import { useStartHref } from "@/components/marketing/use-start-href";
import type { LandingData } from "@/components/marketing/variants/use-landing-data";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import * as React from "react";
import { useFormatter } from "use-intl";

import { PLANK_WIDE, toPlankBox, toRows } from "./plank-data";

// Hero / cover — the signature moment. Oversized stacked typographic art on the
// left, the 3D plank cropped/bleeding off the right edge as a "cover image".
// The <h1> is pure CSS and fully legible with zero JS / zero motion — it is the
// real signature, so the hero never depends on the plank. The plank reuses
// JigPlank3D (lazy + WebGL-gated + reduced-motion-gated internally).

export function HeroCover({ data }: { data: LandingData }) {
  const startHref = useStartHref();
  const format = useFormatter();
  const { stats, plankPuzzles } = data;

  const rows = React.useMemo(
    () =>
      toRows(
        plankPuzzles && plankPuzzles.length >= 3
          ? plankPuzzles.map(toPlankBox)
          : PLANK_WIDE,
      ),
    [plankPuzzles],
  );

  const users = stats ? format.number(stats.totalUsers) : "—";
  const puzzles = stats ? format.number(stats.totalPuzzles) : "—";

  const headline = (
    <h1 className="ed-headline mt-5">
      <span className="sr-only">Lend. Swap. Share.</span>
      <span
        aria-hidden="true"
        className="ed-word"
        style={{ color: "var(--v-accent-violet)" }}
      >
        LEND<span className="ed-dot">.</span>
      </span>
      <span
        aria-hidden="true"
        className="ed-word"
        style={{ color: "var(--v-accent-green)" }}
      >
        SWAP<span className="ed-dot">.</span>
      </span>
      <span
        aria-hidden="true"
        className="ed-word"
        style={{ color: "var(--v-accent-pink)" }}
      >
        SHARE<span className="ed-dot">.</span>
      </span>
    </h1>
  );

  return (
    <section className="overflow-x-clip">
      <div className="w-full max-w-[1200px] mx-auto px-6">
        <div className="grid items-center gap-10 min-[861px]:[grid-template-columns:minmax(0,7fr)_minmax(0,5fr)] pt-[clamp(40px,7vw,88px)] pb-[clamp(56px,8vw,112px)]">
          {/* Type column */}
          <div className="text-left">
            <Reveal>
              <p className="ed-mono text-[12px] font-semibold tracking-[0.16em] uppercase text-mk-text-muted">
                <span className="text-mk-text-strong">Est. 2025</span> · Made at
                a Dutch kitchen table
              </p>
              {headline}
              <p className="mt-7 text-[clamp(16px,1.4vw,19px)] leading-relaxed text-mk-text-body max-w-[42ch] text-pretty">
                A library for jigsaw people. Build your shelf, pass your puzzles
                on, never lose a box.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Button
                  variant="brand"
                  className="h-11 px-6 text-[15px] rounded-[4px]"
                  asChild
                >
                  <Link href={startHref}>
                    Get on the shelf
                    <ArrowRight size={17} />
                  </Link>
                </Button>
                <Button
                  variant="ghost"
                  className="h-11 px-4 text-[15px] rounded-[4px] text-mk-text-strong underline underline-offset-4 decoration-mk-border hover:bg-transparent hover:decoration-[var(--v-accent)]"
                  asChild
                >
                  <Link href="/how-it-works">Read how it works</Link>
                </Button>
              </div>
              <p className="mt-7 text-[14px] text-mk-text-muted">
                <span className="text-mk-text-strong font-semibold tabular-nums">
                  {users}
                </span>{" "}
                puzzlers ·{" "}
                <span className="text-mk-text-strong font-semibold tabular-nums">
                  {puzzles}
                </span>{" "}
                puzzles in the catalogue
              </p>
            </Reveal>
          </div>

          {/* Plank — desktop: bleeds off the right edge as a cropped cover */}
          <div className="hidden min-[861px]:block relative" aria-hidden="true">
            <div
              className="relative"
              style={{
                height: "clamp(380px, 38vw, 540px)",
                marginRight: "calc(50% - 50vw)",
                transform: "rotate(-1.5deg)",
              }}
            >
              <JigPlank3D rows={rows} />
            </div>
          </div>
        </div>
      </div>

      {/* Plank — mobile: contained band below the type, no bleed */}
      <div
        className="min-[861px]:hidden border-y border-mk-border relative overflow-hidden"
        aria-hidden="true"
        style={{ height: "clamp(220px, 55vw, 360px)" }}
      >
        <JigPlank3D rows={rows} />
      </div>
    </section>
  );
}
