import { Container } from "@/components/marketing/container";
import { PieceMotif } from "@/components/marketing/piece-motif";
import { Reveal } from "@/components/marketing/reveal";
import { Eyebrow, Section } from "@/components/marketing/section";

export function SustainBand() {
  return (
    <Section className="relative overflow-x-clip">
      {/* very faint green-tinted glow, top-right */}
      <div
        aria-hidden="true"
        className="absolute top-0 right-0 w-[460px] h-[360px] pointer-events-none"
        style={{
          background:
            "radial-gradient(60% 70% at 80% 10%, color-mix(in oklab, var(--mk-seed-secondary) 14%, transparent), transparent 72%)",
        }}
      />
      <Container narrow className="relative">
        <Reveal>
          <div className="text-center">
            <div className="flex justify-center">
              <Eyebrow center>Why it matters</Eyebrow>
            </div>
            <h2 className="font-mk-heading font-bold tracking-tight text-mk-text-strong text-[clamp(26px,3.6vw,38px)] leading-[1.1] mt-3.5">
              Give every puzzle a second life.
            </h2>
            <p className="mt-4 mx-auto max-w-[600px] text-[clamp(16px,1.4vw,18px)] leading-relaxed text-mk-text-muted text-pretty">
              A finished puzzle deserves better than the attic. Pass it on, and
              it gets a second, third, fourth afternoon with someone new.
            </p>
            <div className="mt-7 flex justify-center" aria-hidden="true">
              <PieceMotif
                size={40}
                color="color-mix(in oklab, var(--mk-green-400) 70%, transparent)"
                rotate={-8}
              />
            </div>
          </div>
        </Reveal>
      </Container>
    </Section>
  );
}
