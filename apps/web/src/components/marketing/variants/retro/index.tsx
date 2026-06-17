import "./retro.css";

import { Link } from "@/compat/link";
import { Reveal } from "@/components/marketing/reveal";
import { Eyebrow, Section } from "@/components/marketing/section";
import { useStartHref } from "@/components/marketing/use-start-href";
import { useLandingData } from "@/components/marketing/variants/use-landing-data";
import { Button } from "@/components/ui/button";
import { AssemblySteps } from "./assembly-steps";
import { BoxLid } from "./box-lid";
import { ContentsList } from "./contents-list";
import { RetroFooter } from "./footer";
import { RetroHeader } from "./header";
import { InsertCard } from "./insert-card";
import { KeepCard } from "./keep-card";
import { NumbersBand } from "./numbers-band";

// Retro / Tactile landing — "A digital shelf for an analog joy." The page IS a
// vintage board-game box: lid → contents → assembly → keep-card → stamped
// numbers → second-life slug → founders' insert → final CTA → box-bottom
// colophon. One display font (Rokkitt slab), paper grain, offset-print craft —
// all pure CSS/SVG. Re-skins shared components by re-pointing --mk-* in retro.css.
export default function RetroLanding() {
  const startHref = useStartHref();
  const { stats, communityAvatars, plankPuzzles } = useLandingData({
    avatarLimit: 4,
    plankLimit: 4,
  });

  return (
    <div className="v-retro font-mk-sans bg-mk-bg text-mk-text-body min-h-screen overflow-x-clip">
      <RetroHeader />

      <main>
        {/* 1 — Hero box lid */}
        <BoxLid
          startHref={startHref}
          stats={stats}
          avatars={communityAvatars}
        />

        {/* 2 — Contents */}
        <Section id="contents">
          <ContentsList puzzles={plankPuzzles} />
        </Section>

        {/* 3 — Assembly */}
        <Section id="assembly" tint>
          <AssemblySteps />
        </Section>

        {/* 4 — Custody / keep-this card */}
        <Section id="custody">
          <Reveal>
            <KeepCard />
          </Reveal>
        </Section>

        {/* 5 — By the numbers (real Convex stats) */}
        <div id="numbers">
          <NumbersBand stats={stats} />
        </div>

        {/* 6 — Second life slug */}
        <Section id="secondlife">
          <Reveal>
            <div className="mx-auto max-w-[760px] px-6 text-center">
              <Eyebrow center>Why</Eyebrow>
              <h2 className="font-mk-heading text-mk-text-strong mx-auto mt-3.5 max-w-[18ch] text-[clamp(26px,3.6vw,38px)] leading-[1.12] font-bold tracking-tight">
                <span
                  aria-hidden="true"
                  className="mr-2 inline-block translate-y-[2px] text-[0.8em]"
                  style={{ color: "var(--mk-seed-secondary)" }}
                >
                  ▷
                </span>
                Give every puzzle another life.
              </h2>
              <p className="text-mk-text-body mx-auto mt-4 max-w-[56ch] text-[clamp(15px,2vw,18px)] leading-relaxed text-pretty">
                A finished puzzle deserves better than the attic. Pass it on,
                and let it be someone else&apos;s slow, satisfying afternoon —
                second life, third, fourth.
              </p>
            </div>
          </Reveal>
        </Section>

        {/* 7 — Founders' insert */}
        <Section id="insert" tint>
          <Reveal>
            <InsertCard />
          </Reveal>
        </Section>

        {/* 8 — Final CTA */}
        <section
          id="open"
          className="w-full overflow-x-clip py-[clamp(56px,8vw,104px)]"
          style={{ background: "var(--v-lid-ground)" }}
        >
          <div className="mx-auto max-w-[680px] px-6 text-center">
            <h2 className="font-mk-heading v-offset text-mk-text-strong text-[clamp(28px,4.6vw,46px)] leading-[1.06] font-extrabold tracking-tight text-balance">
              Lift the lid. Start your shelf.
            </h2>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-3 max-[540px]:flex-col">
              <Button
                variant="brand"
                size="lg"
                className="h-12 px-7 text-[15px] max-[540px]:w-full"
                asChild
              >
                <Link href={startHref}>Open the box</Link>
              </Button>
              <Button
                size="lg"
                className="bg-mk-card text-mk-text-strong border-mk-text-strong hover:bg-mk-muted focus-visible:ring-mk-ring h-12 border-2 px-7 text-[15px] font-semibold shadow-[var(--shadow-mk-sm)] transition-colors focus-visible:ring-2 focus-visible:outline-none max-[540px]:w-full"
                asChild
              >
                <Link href="#contents">See what&apos;s inside</Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <RetroFooter avatars={communityAvatars} />
    </div>
  );
}
