import { Container } from "@/components/marketing/container";
import { Reveal } from "@/components/marketing/reveal";

import { RuleLabel } from "./rule";

// Founders' letter — reframed as a magazine "letter from the founders". This is
// where the warmth is protected: real family, est. 2025, Netherlands, on
// readable --mk-text-body. The drop-cap is decorative (::first-letter) and does
// not alter the real text.
export function FoundersLetter() {
  return (
    <section>
      <RuleLabel label="No. 03 — A letter" />
      <Container narrow className="pb-[clamp(48px,8vw,112px)]">
        <Reveal>
          <p className="ed-mono text-[12px] font-semibold tracking-[0.16em] uppercase text-mk-text-muted">
            A letter · Netherlands · 2025
          </p>
          <blockquote className="mt-7">
            <p className="ed-dropcap text-[clamp(19px,2.2vw,26px)] leading-relaxed text-mk-text-body text-pretty">
              We built JigSwap because our finished puzzles deserved better than
              the attic — and because puzzling is more fun when you share it.
            </p>
            <footer className="mt-6 text-[15px] text-mk-text-muted">
              — The family behind JigSwap, puzzling at the kitchen table since
              2025.
            </footer>
          </blockquote>
        </Reveal>
      </Container>
    </section>
  );
}
