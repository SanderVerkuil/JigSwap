import { Reveal } from "@/components/marketing/reveal";
import { Eyebrow } from "@/components/marketing/section";
import type { PlankPuzzle } from "@/components/marketing/variants/use-landing-data";
import { cn } from "@/lib/utils";

const ITEMS = [
  {
    title: "Your whole shelf, catalogued",
    gloss: "every box in one tidy place, piece counts and all.",
  },
  {
    title: "Lending & swapping",
    gloss: "pass finished puzzles to people who'll actually do them.",
  },
  {
    title: "Custody tracking",
    gloss: "see who currently holds each box you've lent out.",
  },
  {
    title: "A real community",
    gloss: "Dutch puzzlers, growing since 2025.",
  },
  {
    title: "A second life for every puzzle",
    gloss: "out of the attic, back on a table.",
  },
];

// Themed Dutch fallback covers (per research §0) when no real plank data.
const FALLBACK: PlankPuzzle[] = [
  { title: "Boslicht", pieceCount: 1000, image: null },
  { title: "Amsterdam", pieceCount: 1500, image: null },
  { title: "De Nachtwacht", pieceCount: 2000, image: null },
  { title: "Zandsculpturen", pieceCount: 500, image: null },
];

export function ContentsList({
  puzzles,
}: {
  puzzles: PlankPuzzle[] | undefined;
}) {
  const covers = (puzzles && puzzles.length > 0 ? puzzles : FALLBACK).slice(
    0,
    4,
  );

  return (
    <div className="mx-auto w-full max-w-[1200px] px-6">
      <Eyebrow>Contents</Eyebrow>
      <h2 className="font-mk-heading text-mk-text-strong mt-3.5 text-[clamp(28px,4vw,40px)] leading-[1.1] font-bold tracking-tight">
        What&apos;s in the box
      </h2>

      <div className="mt-10 grid grid-cols-[58%_42%] gap-12 max-[860px]:grid-cols-1 max-[860px]:gap-10">
        {/* Checklist */}
        <ul className="flex flex-col">
          {ITEMS.map((item, i) => (
            <Reveal key={item.title} delay={i * 70}>
              <li className="flex items-baseline gap-3 py-3.5">
                <span
                  aria-hidden="true"
                  className="text-mk-seed-secondary translate-y-[2px] text-[18px] leading-none"
                  style={{ color: "var(--mk-seed-secondary)" }}
                >
                  ▣
                </span>
                <span className="flex flex-1 flex-wrap items-baseline">
                  <span className="text-mk-text-strong font-mk-heading text-[17px] font-bold">
                    {item.title}
                  </span>
                  <span className="v-leader mx-2 min-w-6 flex-1 translate-y-[-3px]" />
                  <span className="text-mk-text-body text-[14.5px] leading-snug">
                    {item.gloss}
                  </span>
                </span>
              </li>
            </Reveal>
          ))}
        </ul>

        {/* Parts bag */}
        <Reveal delay={120}>
          <div className="paper v-box border-mk-text-strong relative overflow-hidden border-[3px] p-5 [transform:rotate(1.5deg)] max-[860px]:[transform:none]">
            <p
              aria-hidden="true"
              className="text-mk-text-muted mb-3 text-center font-mono text-[10.5px] font-bold tracking-[0.16em] uppercase"
            >
              Real boxes from the catalogue
            </p>
            <div className="grid grid-cols-2 gap-3" aria-hidden="true">
              {covers.map((p, i) => (
                <PartCover key={i} puzzle={p} />
              ))}
            </div>
          </div>
        </Reveal>
      </div>
    </div>
  );
}

function PartCover({ puzzle }: { puzzle: PlankPuzzle }) {
  return (
    <div
      className={cn(
        "border-mk-border bg-mk-muted relative aspect-[4/3] overflow-hidden rounded-[var(--v-radius-chip)] border-2",
      )}
    >
      {puzzle.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={puzzle.image}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
        />
      ) : (
        <div
          className="flex h-full w-full flex-col items-center justify-center p-2 text-center"
          style={{
            background:
              "linear-gradient(135deg, color-mix(in oklab, var(--mk-seed-accent) 35%, var(--mk-muted)), var(--mk-muted))",
          }}
        >
          <span className="text-mk-text-strong font-mk-heading text-[13px] leading-tight font-bold">
            {puzzle.title}
          </span>
          <span className="text-mk-text-muted mt-1 font-mono text-[9.5px] font-semibold tracking-wide uppercase">
            {puzzle.pieceCount} pcs
          </span>
        </div>
      )}
    </div>
  );
}
