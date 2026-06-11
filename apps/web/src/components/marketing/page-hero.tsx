import { Container } from "@/components/marketing/container";
import { Reveal } from "@/components/marketing/reveal";
import { Eyebrow } from "@/components/marketing/section";
import * as React from "react";

// Sub-page header band: hero glow, eyebrow, display title, optional lead.
export function PageHero({
  eyebrow,
  title,
  lead,
}: {
  eyebrow: React.ReactNode;
  title: React.ReactNode;
  lead?: React.ReactNode;
}) {
  return (
    <div className="relative overflow-hidden border-b border-mk-border">
      <div className="mk-hero-glow" />
      <Container className="relative">
        <div className="py-[clamp(48px,6vw,84px)]">
          <Reveal>
            <Eyebrow>{eyebrow}</Eyebrow>
            <h1 className="font-mk-heading font-bold tracking-tight text-mk-text-strong text-[clamp(34px,5vw,54px)] leading-[1.08] mt-4 max-w-[940px]">
              {title}
            </h1>
            {lead && (
              <p className="text-[clamp(17px,1.4vw,20px)] leading-relaxed text-mk-text-muted mt-[18px] text-pretty max-w-[640px]">
                {lead}
              </p>
            )}
          </Reveal>
        </div>
      </Container>
    </div>
  );
}
