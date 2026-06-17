import { Container } from "@/components/marketing/container";
import { Reveal } from "@/components/marketing/reveal";
import { Section } from "@/components/marketing/section";
import type { LandingData } from "@/components/marketing/variants/use-landing-data";
import { AvatarCluster } from "./avatar-cluster";

export function Founders({ data }: { data: LandingData }) {
  return (
    <Section tint>
      <Container>
        <Reveal>
          <figure className="mx-auto max-w-[760px] bg-mk-card border border-mk-border shadow-mk-md rounded-[var(--v-radius-card)] p-[clamp(28px,4vw,48px)] text-center">
            <h2 className="sr-only">A note from the founders</h2>
            <blockquote className="font-mk-heading font-semibold text-mk-text-strong text-[clamp(18px,2.4vw,28px)] leading-[1.3] text-balance">
              &ldquo;We built JigSwap because our finished puzzles deserved
              better than the attic — and because puzzling is more fun when you
              share it.&rdquo;
            </blockquote>
            <figcaption className="mt-6 flex flex-col items-center gap-3">
              <AvatarCluster avatars={data.communityAvatars} size={34} />
              <span className="text-[14.5px] text-mk-text-muted">
                The family behind JigSwap, puzzling at the kitchen table since
                2025.
              </span>
            </figcaption>
          </figure>
        </Reveal>
      </Container>
    </Section>
  );
}
