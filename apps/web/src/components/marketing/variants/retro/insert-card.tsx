// Founders' quote as a printed insert / leaflet: cream stock, heavier grain, a
// dashed perforation edge, and a slight tilt (desktop only).
export function InsertCard() {
  return (
    <div className="mx-auto w-full max-w-[760px] px-6">
      <figure className="paper-heavy v-perf border-mk-border relative overflow-hidden rounded-[var(--v-radius-box)] border-2 px-[clamp(22px,5vw,52px)] py-[clamp(32px,5vw,52px)] shadow-[var(--shadow-mk-md)] [transform:rotate(-1.2deg)] max-[860px]:[transform:none]">
        <p
          aria-hidden="true"
          className="text-mk-text-muted mb-5 font-mono text-[10.5px] font-bold tracking-[0.18em] uppercase"
        >
          A note from inside the box
        </p>
        <blockquote className="font-mk-heading text-mk-text-strong text-[clamp(20px,3vw,28px)] leading-[1.32] font-medium text-balance italic">
          “We built JigSwap because our finished puzzles deserved better than
          the attic — and because puzzling is more fun when you share it.”
        </blockquote>
        <figcaption className="font-mk-heading text-mk-text-body mt-5 text-[14px] font-semibold tracking-[0.04em] uppercase">
          — The family behind JigSwap, puzzling at the kitchen table since 2025.
        </figcaption>
      </figure>
    </div>
  );
}
