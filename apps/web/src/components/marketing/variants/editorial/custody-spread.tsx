import { Container } from "@/components/marketing/container";
import { Reveal } from "@/components/marketing/reveal";

// Custody spread — the trust differentiator, confidently stated. Left: heading
// + body (the meaning). Right: a purely-decorative typographic diagram of the
// custody loop (YOUR SHELF → A FELLOW PUZZLER → BACK TO YOU).

function Node({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center justify-center border border-mk-border rounded-full px-4 py-2 ed-mono text-[11px] font-semibold tracking-[0.14em] uppercase text-mk-text-body bg-mk-card whitespace-nowrap">
      {label}
    </span>
  );
}

function Arrow({ vertical = false }: { vertical?: boolean }) {
  return vertical ? (
    <svg
      width="20"
      height="34"
      viewBox="0 0 20 34"
      fill="none"
      aria-hidden="true"
      className="my-1"
    >
      <path
        d="M10 2 V26"
        stroke="var(--v-accent)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M4 22 L10 30 L16 22"
        stroke="var(--v-accent)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  ) : (
    <svg
      width="42"
      height="20"
      viewBox="0 0 42 20"
      fill="none"
      aria-hidden="true"
      className="mx-1 shrink-0"
    >
      <path
        d="M2 10 H34"
        stroke="var(--v-accent)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M28 4 L36 10 L28 16"
        stroke="var(--v-accent)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

export function CustodySpread() {
  return (
    <section className="bg-mk-muted border-y border-mk-border py-[clamp(56px,8vw,104px)]">
      <Container>
        <Reveal>
          <div className="grid gap-12 min-[861px]:grid-cols-2 min-[861px]:items-center">
            <div>
              <h2 className="font-mk-heading font-bold tracking-tight text-mk-text-strong text-[clamp(30px,5vw,56px)] leading-[1.04]">
                Who has your box?
              </h2>
              <p className="mt-5 text-[clamp(16px,1.4vw,19px)] leading-relaxed text-mk-text-body max-w-[48ch] text-pretty">
                Lend a puzzle and you&rsquo;ll never wonder where it went. Every
                box you send out shows exactly who&rsquo;s holding it — so
                sharing your favourites never means losing them.
              </p>
            </div>

            {/* Decorative typographic diagram */}
            <div aria-hidden="true">
              {/* Desktop: horizontal flow with loop-back */}
              <div className="hidden min-[861px]:block">
                <div className="flex items-center justify-center flex-wrap gap-y-3">
                  <Node label="Your shelf" />
                  <Arrow />
                  <Node label="A fellow puzzler" />
                  <Arrow />
                  <Node label="Back to you" />
                </div>
                <div className="mt-4 flex justify-center">
                  <svg
                    width="100%"
                    height="28"
                    viewBox="0 0 320 28"
                    fill="none"
                    preserveAspectRatio="none"
                    className="max-w-[320px]"
                  >
                    <path
                      d="M300 2 V14 Q300 22 292 22 H28 Q20 22 20 14 V2"
                      stroke="var(--v-accent)"
                      strokeWidth="2"
                      strokeLinecap="round"
                      fill="none"
                      strokeDasharray="4 5"
                    />
                    <path
                      d="M14 8 L20 1 L26 8"
                      stroke="var(--v-accent)"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      fill="none"
                    />
                  </svg>
                </div>
              </div>
              {/* Mobile: vertical flow */}
              <div className="min-[861px]:hidden flex flex-col items-center">
                <Node label="Your shelf" />
                <Arrow vertical />
                <Node label="A fellow puzzler" />
                <Arrow vertical />
                <Node label="Back to you" />
              </div>
            </div>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
