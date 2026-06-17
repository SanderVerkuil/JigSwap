import { Reveal } from "@/components/marketing/reveal";
import { Section } from "@/components/marketing/section";
import type { LandingData } from "@/components/marketing/variants/use-landing-data";
import * as React from "react";
import { useFormatter } from "use-intl";
import { CountUp } from "./count-up";

type Pill = { value: number | undefined; label: string };

function StatPill({ pill, delay }: { pill: Pill; delay: number }) {
  const format = useFormatter();
  const [active, setActive] = React.useState(false);

  return (
    <Reveal
      delay={delay}
      className="max-[860px]:w-full max-[860px]:max-w-[360px]"
    >
      {/* Trigger the count-up once the pill scrolls into view. */}
      <InView onEnter={() => setActive(true)}>
        <div className="v-lift inline-flex w-full flex-col items-center bg-mk-card border border-mk-border shadow-mk-sm px-[clamp(24px,3vw,36px)] py-[clamp(20px,2.4vw,28px)] rounded-[var(--v-radius-pill)] text-center">
          <span className="font-mk-heading font-bold text-mk-text-strong leading-none text-[clamp(30px,4vw,44px)] tabular-nums">
            {pill.value != null ? (
              <CountUp
                value={pill.value}
                active={active}
                format={(n) => format.number(n)}
              />
            ) : (
              "—"
            )}
          </span>
          <span className="mt-2 text-[14px] font-medium text-mk-text-muted">
            {pill.label}
          </span>
        </div>
      </InView>
    </Reveal>
  );
}

// Tiny intersection trigger so the count-up only fires when seen (and only
// once). Reveal handles the fade; this handles the number tween activation.
function InView({
  onEnter,
  children,
}: {
  onEnter: () => void;
  children: React.ReactNode;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            onEnter();
            io.disconnect();
          }
        }
      },
      { threshold: 0.3 },
    );
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <div ref={ref}>{children}</div>;
}

export function StatPills({ data }: { data: LandingData }) {
  const { stats } = data;
  const pills: Pill[] = [
    { value: stats?.totalUsers, label: "puzzlers signed up" },
    { value: stats?.totalPuzzles, label: "puzzles in the catalog" },
    { value: stats?.totalOwnedPuzzles, label: "puzzles on shelves right now" },
  ];

  return (
    <Section>
      <div className="w-full max-w-[1200px] mx-auto px-6">
        <h2 className="sr-only">JigSwap by the numbers</h2>
        <div className="flex flex-wrap justify-center items-center gap-[clamp(16px,2vw,28px)] max-[860px]:flex-col">
          {pills.map((pill, i) => (
            <StatPill key={pill.label} pill={pill} delay={i * 90} />
          ))}
        </div>
      </div>
    </Section>
  );
}
