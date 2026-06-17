import { Container } from "@/components/marketing/container";
import { Reveal } from "@/components/marketing/reveal";
import { cn } from "@/lib/utils";

import { RuleLabel } from "./rule";

// The loop told as three numbered editorial "articles" (01 / 02 / 03),
// alternating numeral-left / numeral-right. The numeral is a faint watermark
// (aria-hidden); the kicker → h3 → body carry the meaning in DOM order.

type Spread = {
  no: string;
  kicker: string;
  title: string;
  body: string;
};

const SPREADS: Spread[] = [
  {
    no: "01",
    kicker: "No. 01 — Fill your shelf",
    title: "Catalogue every box.",
    body: "Shelve your whole collection in one place — covers, piece counts, the lot. Your library, finally organised.",
  },
  {
    no: "02",
    kicker: "No. 02 — Discover & request",
    title: "Find your next 1,000 pieces.",
    body: "Browse what the community is passing on, then request a swap or a borrow. New puzzles, no new clutter.",
  },
  {
    no: "03",
    kicker: "No. 03 — Lend & track",
    title: "Pass it on, keep the thread.",
    body: "Lend a box and JigSwap keeps the receipt — you always see who's got it and when it's coming home.",
  },
];

function SpreadRow({ spread, index }: { spread: Spread; index: number }) {
  const numeralRight = index === 1; // 01 left, 02 right, 03 left

  const numeral = (
    <div
      aria-hidden="true"
      className="hidden min-[861px]:flex items-center justify-center select-none pointer-events-none"
    >
      <span className="ed-watermark">{spread.no}</span>
    </div>
  );

  const text = (
    <div className="relative">
      {/* Mobile watermark: sits behind the text, never pushes layout */}
      <span
        aria-hidden="true"
        className="ed-watermark min-[861px]:hidden absolute -top-4 -left-2 opacity-90 pointer-events-none"
      >
        {spread.no}
      </span>
      <div className="relative">
        <p className="ed-mono text-[12px] font-semibold tracking-[0.16em] uppercase text-mk-text-muted">
          {spread.kicker}
        </p>
        <h3 className="font-mk-heading font-bold tracking-tight text-mk-text-strong text-[clamp(28px,4.5vw,46px)] leading-[1.05] mt-3">
          {spread.title}
        </h3>
        <p className="mt-4 text-[clamp(16px,1.3vw,18px)] leading-relaxed text-mk-text-body max-w-[52ch] text-pretty">
          {spread.body}
        </p>
      </div>
    </div>
  );

  return (
    <Reveal delay={index * 80}>
      <div
        className={cn(
          "grid gap-8 items-center py-[clamp(40px,7vw,84px)]",
          "min-[861px]:[grid-template-columns:minmax(0,4fr)_minmax(0,8fr)]",
        )}
      >
        {numeralRight ? (
          <>
            <div className="min-[861px]:order-2">{numeral}</div>
            <div className="min-[861px]:order-1">{text}</div>
          </>
        ) : (
          <>
            {numeral}
            {text}
          </>
        )}
      </div>
    </Reveal>
  );
}

export function LoopSpreads() {
  return (
    <section>
      <RuleLabel label="No. 02 — The loop" />
      <Container>
        <div className="divide-y divide-mk-border">
          {SPREADS.map((spread, i) => (
            <SpreadRow key={spread.no} spread={spread} index={i} />
          ))}
        </div>
      </Container>
    </section>
  );
}
