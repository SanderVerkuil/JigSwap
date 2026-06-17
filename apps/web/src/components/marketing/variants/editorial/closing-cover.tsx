import { Link } from "@/compat/link";
import { Container } from "@/components/marketing/container";
import { Reveal } from "@/components/marketing/reveal";
import { useStartHref } from "@/components/marketing/use-start-href";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

// Closing cover — the "back cover". Inverts to the ink ground via the
// `editorial-invert` scope (which re-points --mk-* so shared Button + text
// stay correct in both light and dark). Big-type sign-off + the final ask.
export function ClosingCover() {
  const startHref = useStartHref();

  return (
    <section className="editorial-invert bg-mk-bg text-mk-text-strong py-[clamp(64px,10vw,140px)]">
      <Container>
        <Reveal>
          <p className="ed-mono text-[12px] font-semibold tracking-[0.16em] uppercase text-[var(--v-accent)]">
            Stop hoarding masterpieces. Start a shelf.
          </p>
          <h2 className="ed-bigtype mt-5">
            GET ON THE SHELF<span className="ed-dot">.</span>
          </h2>
          <div className="mt-9 flex flex-col min-[861px]:flex-row gap-3 min-[861px]:items-center">
            <Button
              variant="brand"
              className="h-12 px-7 text-[15px] rounded-[4px] max-[860px]:w-full"
              asChild
            >
              <Link href={startHref}>
                Get on the shelf
                <ArrowRight size={17} />
              </Link>
            </Button>
            <Button
              variant="ghost"
              className="h-12 px-5 text-[15px] rounded-[4px] text-mk-text-strong underline underline-offset-4 decoration-mk-border hover:bg-transparent hover:decoration-[var(--v-accent)] max-[860px]:w-full"
              asChild
            >
              <Link href="/how-it-works">Read how it works</Link>
            </Button>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
