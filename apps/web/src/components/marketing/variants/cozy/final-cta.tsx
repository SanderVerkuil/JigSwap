import { Link } from "@/compat/link";
import { Container } from "@/components/marketing/container";
import { Section } from "@/components/marketing/section";
import { useStartHref } from "@/components/marketing/use-start-href";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

// Section 6 — gentle final CTA. Warm ground with a soft radial "lamp glow"
// behind the lockup; no pressure, just an open door.
export function FinalCta() {
  const startHref = useStartHref();

  return (
    <Section className="relative overflow-clip">
      {/* Soft lamp glow behind the lockup (decorative). */}
      <div
        aria-hidden="true"
        className="cozy-lamp-glow pointer-events-none absolute inset-x-0 top-1/2 -z-0 mx-auto h-[420px] max-w-[760px] -translate-y-1/2"
      />
      <Container>
        <div className="relative mx-auto flex max-w-[760px] flex-col items-center text-center">
          <h2 className="font-mk-heading text-mk-text-strong font-semibold tracking-tight text-[clamp(28px,4.4vw,44px)] leading-[1.08]">
            Pull up a chair. Bring your puzzles.
          </h2>
          <p className="text-mk-text-body mt-4 max-w-[52ch] text-[clamp(16px,1.8vw,19px)] leading-relaxed text-pretty">
            A warm home for your jigsaw collection — lend, swap, and share with
            people who love them as much as you do.
          </p>

          <div className="mt-8 flex w-full flex-wrap justify-center gap-3 max-[540px]:flex-col">
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

          <p className="text-mk-text-muted mt-6 text-[14px]">
            Kettle&rsquo;s on. Add your first puzzle whenever you&rsquo;re
            ready.
          </p>
        </div>
      </Container>
    </Section>
  );
}
