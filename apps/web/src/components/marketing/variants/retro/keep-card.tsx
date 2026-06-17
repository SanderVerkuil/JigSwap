import * as React from "react";

// "Keep this card" — a detachable warranty/registration card. Brick-tinted
// inset, perforated dashed top edge, a small KEEP THIS stamp, and a tiny
// box → person → box typographic diagram.
export function KeepCard() {
  return (
    <div className="mx-auto w-full max-w-[760px] px-6">
      <div
        className="v-perf paper relative overflow-hidden rounded-[var(--v-radius-box)] px-[clamp(20px,5vw,48px)] pt-9 pb-[clamp(28px,4vw,40px)] shadow-[var(--shadow-mk-md)]"
        style={{
          backgroundColor:
            "color-mix(in oklab, var(--mk-seed-primary) 9%, var(--mk-card))",
        }}
      >
        <span
          aria-hidden="true"
          className="absolute top-4 right-4 inline-flex rotate-[-4deg] items-center gap-1 rounded-[var(--v-radius-chip)] px-2.5 py-1 font-mono text-[10px] font-bold tracking-[0.14em] uppercase"
          style={{ background: "var(--v-band-teal)", color: "#fbf3df" }}
        >
          ✶ Keep this
        </span>

        <h2 className="font-mk-heading text-mk-text-strong max-w-[16ch] text-[clamp(24px,3.4vw,34px)] leading-[1.1] font-bold tracking-tight">
          Never lose a box again.
        </h2>
        <p className="text-mk-text-body mt-4 max-w-[56ch] text-[clamp(15px,2vw,17px)] leading-relaxed text-pretty">
          Lend a puzzle out and JigSwap remembers exactly who has it. No
          guesswork, no “didn&apos;t I lend that to someone?” — just box →
          person → back to your shelf.
        </p>

        <div
          aria-hidden="true"
          className="text-mk-text-strong mt-6 flex flex-wrap items-center gap-2 font-mono text-[12px] font-bold tracking-[0.08em] uppercase"
        >
          <Chip>📦 Your box</Chip>
          <Arrow />
          <Chip>🧑 A puzzler</Chip>
          <Arrow />
          <Chip>📦 Back to you</Chip>
        </div>
      </div>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="border-mk-border bg-mk-card inline-flex items-center rounded-[var(--v-radius-chip)] border-2 px-3 py-1.5">
      {children}
    </span>
  );
}

function Arrow() {
  return <span className="text-mk-text-muted text-[16px] leading-none">→</span>;
}
