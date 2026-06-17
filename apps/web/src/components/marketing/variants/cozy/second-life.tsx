import { Link } from "@/compat/link";
import { Container } from "@/components/marketing/container";
import { Reveal } from "@/components/marketing/reveal";
import { Eyebrow } from "@/components/marketing/section";
import { ArrowRight } from "lucide-react";
import { PhotoFallback } from "./photo-fallback";

// Section 4 — Second life, promoted to a hero-weight emotional section (the
// cozy "why"). Deeper warm band, asymmetric two-column, extra whitespace.
export function SecondLife() {
  return (
    <section
      className="py-[clamp(72px,9vw,104px)]"
      style={{
        background:
          "linear-gradient(180deg, color-mix(in oklab, var(--mk-seed-accent) 12%, var(--mk-bg)), color-mix(in oklab, var(--mk-seed-primary) 9%, var(--mk-bg)))",
      }}
    >
      <Container>
        <div className="grid items-center gap-[clamp(32px,5vw,64px)] min-[861px]:grid-cols-[52fr_48fr]">
          <Reveal>
            <PhotoFallback
              label="a puzzle being handed from one person to another"
              className="aspect-[4/3] w-full rounded-[28px] shadow-mk-lg"
            />
          </Reveal>

          <div className="max-w-[560px]">
            <Eyebrow>The cozy why</Eyebrow>
            <h2 className="font-mk-heading text-mk-text-strong mt-4 font-semibold tracking-tight text-[clamp(28px,4.4vw,44px)] leading-[1.08]">
              A finished puzzle isn&rsquo;t finished.
            </h2>
            <p className="text-mk-text-body mt-5 text-[clamp(16px,1.8vw,19px)] leading-relaxed text-pretty">
              Most puzzles get done once, then live out their days in the attic.
              Here, they get handed on — a second rainy afternoon for someone
              new, a smaller pile of forgotten boxes for everyone.
            </p>
            <p className="text-mk-text-strong mt-5 border-l-2 border-[var(--mk-seed-secondary)] pl-4 text-[15px] leading-relaxed font-medium italic">
              Every 1,000-piece box passed on is one less in a landfill — and
              one more shared evening.
            </p>
            <Link
              href="/how-it-works"
              className="text-mk-violet-600 ring-offset-mk-bg focus-visible:ring-mk-ring mt-7 inline-flex min-h-11 items-center gap-1.5 text-[15px] font-semibold hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
            >
              See how second life works
              <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </Container>
    </section>
  );
}
