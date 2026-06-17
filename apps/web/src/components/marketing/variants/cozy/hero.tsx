import { Link } from "@/compat/link";
import coverSand from "@/components/marketing/assets/cover-sand.webp";
import { Container } from "@/components/marketing/container";
import { PieceMotif } from "@/components/marketing/piece-motif";
import { Eyebrow } from "@/components/marketing/section";
import { useStartHref } from "@/components/marketing/use-start-href";
import type { LandingStats } from "@/components/marketing/variants/use-landing-data";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { PhotoFallback } from "./photo-fallback";

// Humanized live trust line. While stats load we show "Pull up a chair…" — we
// never announce 0. Once loaded we inject the real totalUsers.
function TrustLine({ stats }: { stats: LandingStats | undefined }) {
  if (stats === undefined) {
    return (
      <p className="text-mk-text-muted mt-7 text-[15px] leading-snug">
        Pull up a chair…
      </p>
    );
  }
  return (
    <p className="text-mk-text-muted mt-7 text-[15px] leading-snug">
      <span className="text-mk-text-strong font-semibold">
        {stats.totalUsers.toLocaleString()}
      </span>{" "}
      puzzlers gathered round the table
    </p>
  );
}

// The "warm window" art zone: a [PHOTO PLACEHOLDER] gradient box with the one
// real photo (cover-sand) tucked into a corner as a small duotone card, plus a
// couple of softly drifting puzzle pieces. Entirely decorative.
function WarmWindow() {
  return (
    <div className="relative" aria-hidden="true">
      <PhotoFallback
        label="hands placing a puzzle piece, warm window light, coffee mug"
        className="aspect-[4/3] w-full rounded-[28px] shadow-mk-lg max-[860px]:aspect-[4/3] min-[861px]:aspect-[5/6]"
      />

      {/* The single real photographic touch — duotone-tinted into the palette. */}
      <div className="cozy-duotone absolute -top-5 -right-3 h-[96px] w-[96px] rotate-[4deg] rounded-2xl shadow-mk-md ring-4 ring-[var(--mk-card)] min-[861px]:h-[140px] min-[861px]:w-[140px]">
        <img
          src={coverSand}
          alt=""
          className="h-full w-full object-cover"
          loading="eager"
          decoding="async"
        />
      </div>

      {/* Floating soft pieces — drift stops under reduced-motion. */}
      <PieceMotif
        size={64}
        color="var(--mk-violet-300)"
        className="cozy-drift absolute -bottom-6 -left-5"
        style={{ opacity: 0.16, ["--cozy-rot" as string]: "-8deg" }}
      />
      <PieceMotif
        size={44}
        color="var(--mk-green-400)"
        className="cozy-drift absolute top-1/2 -left-8"
        style={{
          opacity: 0.12,
          animationDelay: "-5s",
          ["--cozy-rot" as string]: "12deg",
        }}
      />
      <PieceMotif
        size={38}
        color="var(--mk-pink-400)"
        className="cozy-drift absolute bottom-8 right-6"
        style={{
          opacity: 0.14,
          animationDelay: "-9s",
          ["--cozy-rot" as string]: "6deg",
        }}
      />
    </div>
  );
}

// Cozy hero — "lamplight, not screen-light". A layered, warm, photographic-
// feeling scene built from CSS gradients + grain + one real corner photo + soft
// drifting pieces. No interactive gimmick: the warmth itself is the hook, and
// the static SSR render carries all meaning (headline + subhead + CTAs + count).
export function CozyHero({ stats }: { stats: LandingStats | undefined }) {
  const startHref = useStartHref();

  return (
    <section className="cozy-hero-ground cozy-grain relative overflow-clip">
      <Container>
        <div className="grid min-h-[clamp(560px,78vh,760px)] items-center gap-[clamp(32px,5vw,64px)] py-[clamp(48px,7vw,88px)] min-[861px]:grid-cols-[58fr_42fr]">
          {/* On mobile the art comes first (emotional hook), then the lockup. */}
          <div className="order-1 min-[861px]:order-2">
            <WarmWindow />
          </div>

          {/* Lockup — bottom-biased on desktop. A soft scrim keeps AA over art. */}
          <div className="order-2 flex flex-col justify-end min-[861px]:order-1">
            <Eyebrow>Rainy-day approved · since 2025</Eyebrow>
            <h1 className="font-mk-heading text-mk-text-strong mt-4 font-semibold tracking-tight text-[clamp(34px,6.2vw,60px)] leading-[1.06]">
              Every puzzle deserves another rainy afternoon.
            </h1>
            <p className="text-mk-text-body mt-5 max-w-[46ch] text-[clamp(16px,2.2vw,20px)] leading-relaxed text-pretty">
              Shelve your boxes, share them with the community, and give
              finished puzzles a second life.
            </p>

            <div className="mt-8 flex flex-wrap gap-3 max-[540px]:flex-col">
              <Button
                variant="brand"
                className="h-12 px-6 text-[15px] max-[540px]:w-full"
                asChild
              >
                <Link href={startHref}>
                  Find your puzzle people
                  <ArrowRight size={17} />
                </Link>
              </Button>
              <Button
                variant="outline"
                className="bg-mk-card border-mk-border text-mk-text-strong hover:bg-mk-muted h-12 px-6 text-[15px] max-[540px]:w-full"
                asChild
              >
                <Link href="/how-it-works">Take a look around</Link>
              </Button>
            </div>

            <TrustLine stats={stats} />
          </div>
        </div>
      </Container>
    </section>
  );
}
