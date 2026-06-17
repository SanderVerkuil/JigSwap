import { Container } from "@/components/marketing/container";
import { Reveal } from "@/components/marketing/reveal";

import { RuleLabel } from "./rule";

// Manifesto block: a single large pull-quote stating the conviction — sharing
// beats hoarding. Asymmetric: the quote spans the wide column, a mono right
// rail carries the supporting line.
export function Manifesto() {
  return (
    <section>
      <RuleLabel label="No. 01 — Manifesto" />
      <Container className="pb-[clamp(48px,8vw,112px)]">
        <Reveal>
          <div className="grid gap-8 min-[861px]:[grid-template-columns:minmax(0,9fr)_minmax(0,3fr)] min-[861px]:items-end">
            <blockquote className="relative">
              <span
                aria-hidden="true"
                className="ed-quote-mark block mb-[-0.3em]"
              >
                &ldquo;
              </span>
              <p className="ed-quote max-w-[18ch]">
                The attic was a terrible place to keep a{" "}
                <span className="ed-quote-accent">masterpiece</span>.
              </p>
            </blockquote>
            <p className="text-[15px] leading-relaxed text-mk-text-body max-w-[34ch] min-[861px]:text-right">
              Finished puzzles deserve a second life — and a community to share
              them with. Sharing beats hoarding.
            </p>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
