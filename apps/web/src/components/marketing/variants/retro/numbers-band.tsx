import { Reveal } from "@/components/marketing/reveal";
import type { LandingStats } from "@/components/marketing/variants/use-landing-data";
import { StampStat } from "./stamp-stat";

// Full-bleed teal "by the numbers" band — three REAL Convex totals rendered as
// rubber-stamp figures. Real totals only; never fabricated.
export function NumbersBand({ stats }: { stats: LandingStats | undefined }) {
  return (
    <section
      className="w-full overflow-x-clip py-[clamp(56px,8vw,104px)]"
      style={{ background: "var(--v-band-teal)" }}
    >
      <div className="mx-auto w-full max-w-[1200px] px-6 text-center">
        <div
          className="inline-flex items-center gap-2 font-mono text-xs font-semibold tracking-[0.14em] uppercase"
          style={{ color: "var(--v-on-band)" }}
        >
          <span
            className="h-0.5 w-[18px] rounded-xs"
            style={{ background: "var(--v-on-band)" }}
          />
          By the numbers
        </div>
        <h2
          className="font-mk-heading mx-auto mt-3.5 max-w-[20ch] text-[clamp(28px,4vw,40px)] leading-[1.1] font-bold tracking-tight"
          style={{ color: "var(--v-on-band)" }}
        >
          A growing box of puzzlers
        </h2>

        <div className="mt-12 flex flex-wrap items-center justify-center gap-[clamp(20px,4vw,56px)]">
          <Reveal delay={0}>
            <StampStat
              value={stats?.totalUsers}
              caption="Puzzlers"
              rotate="-2deg"
            />
          </Reveal>
          <Reveal delay={120}>
            <StampStat
              value={stats?.totalPuzzles}
              caption="Puzzles catalogued"
              rotate="1.5deg"
            />
          </Reveal>
          <Reveal delay={240}>
            <StampStat
              value={stats?.totalOwnedPuzzles}
              caption="On shelves"
              rotate="-1deg"
            />
          </Reveal>
        </div>
      </div>
    </section>
  );
}
