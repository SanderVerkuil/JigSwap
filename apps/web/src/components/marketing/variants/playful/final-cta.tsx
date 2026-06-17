import { Link } from "@/compat/link";
import { Container } from "@/components/marketing/container";
import { Reveal } from "@/components/marketing/reveal";
import { Eyebrow, Section } from "@/components/marketing/section";
import { useStartHref } from "@/components/marketing/use-start-href";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

export function FinalCta() {
  const startHref = useStartHref();
  return (
    <Section className="relative overflow-x-clip">
      {/* The only other brand glow besides the hero. */}
      <div className="v-glow" aria-hidden="true" />
      <Container narrow className="relative z-[1]">
        <Reveal>
          <div className="text-center">
            <div className="flex justify-center">
              <Eyebrow center>Ready when you are</Eyebrow>
            </div>
            <h2 className="font-mk-heading font-bold tracking-tight text-mk-text-strong text-[clamp(28px,4vw,44px)] leading-[1.08] mt-3.5 text-balance">
              Start your shelf today.
            </h2>
            <p className="mt-4 mx-auto max-w-[520px] text-[clamp(16px,1.4vw,18px)] leading-relaxed text-mk-text-muted text-pretty">
              It&apos;s free to start — add your first box and let the swapping
              begin.
            </p>
            <div className="mt-8 flex justify-center gap-3 flex-wrap max-[860px]:flex-col max-[860px]:items-stretch">
              <Button
                variant="brand"
                className="h-11 px-6 text-[15px] max-[860px]:w-full"
                asChild
              >
                <Link href={startHref}>
                  Start your shelf
                  <ArrowRight size={17} />
                </Link>
              </Button>
              <Button
                variant="outline"
                className="h-11 px-6 text-[15px] bg-mk-card border-mk-border text-mk-text-strong hover:bg-mk-muted max-[860px]:w-full"
                asChild
              >
                <Link href="/how-it-works">See how it works</Link>
              </Button>
            </div>
            <p className="mt-5 text-[13px] text-mk-text-muted">
              Free to start. No card needed.
            </p>
          </div>
        </Reveal>
      </Container>
    </Section>
  );
}
