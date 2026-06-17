import { Container } from "@/components/marketing/container";
import { PieceMotif } from "@/components/marketing/piece-motif";
import { Reveal } from "@/components/marketing/reveal";
import { Section } from "@/components/marketing/section";

// Section 5 — Founders' note. The human trust anchor, rendered as a grainy,
// faintly-rotated note "placed on the table". Rotation is a static transform
// (not an animation), reduced to 0.8deg on the smallest screens to guarantee no
// overflow at 320px. The card lives inside the page's overflow-x-clip root.
export function FoundersNote() {
  return (
    <Section>
      <Container>
        <Reveal>
          <figure className="cozy-grain bg-mk-card border-mk-border shadow-mk-lg relative mx-auto max-w-[680px] rotate-[1.5deg] rounded-[var(--v-radius-note)] border p-[clamp(24px,6vw,40px)] max-[540px]:rotate-[0.8deg]">
            {/* Decorative "pin" holding the note to the table. */}
            <PieceMotif
              size={40}
              color="var(--mk-seed-primary)"
              rotate={-18}
              className="absolute -top-4 -left-3 drop-shadow-sm"
              style={{ opacity: 0.85 }}
            />

            <blockquote className="font-mk-heading text-mk-text-strong text-[clamp(20px,3vw,27px)] leading-[1.4] font-normal italic text-pretty">
              “We built JigSwap because our finished puzzles deserved better
              than the attic — and because puzzling is more fun when you share
              it.”
            </blockquote>
            <figcaption className="text-mk-text-muted mt-5 text-[13px] font-semibold tracking-[0.08em] uppercase">
              The family behind JigSwap, puzzling at the kitchen table since
              2025.
            </figcaption>
          </figure>
        </Reveal>
      </Container>
    </Section>
  );
}
