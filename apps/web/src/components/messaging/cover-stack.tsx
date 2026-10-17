"use client";

// The puzzles an inbox row is about, as a fanned stack of small covers at the
// start of the row's second line (same 20px line box as the snippet beside
// it). The first cover sits on top, each next one slightly behind; hovering or
// keyboard-focusing the row spreads them apart, and the cover under the
// pointer lifts. Purely presentational inside the row link: the group's
// summary label ("About 5 puzzles: A, B, C and 2 more") is what the link
// announces, and each cover still carries its title as its name and tooltip.
import { Image } from "@/compat/image";
import { cn } from "@/lib/utils";
import { Puzzle } from "lucide-react";
import { COVER_STACK_VISIBLE, type InboxContextCopy } from "./format";

// Stacking order, front to back (static classes so Tailwind sees them).
const Z_INDEX = ["z-[4]", "z-[3]", "z-[2]", "z-[1]"];

// Shared tile box: overlapped at rest, spread on row hover/focus; transitions
// are dropped under prefers-reduced-motion (the spacing still changes).
const tileClass = (index: number, ringClass: string) =>
  cn(
    "relative -my-0.5 flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-[5px] ring-2 transition-[margin,translate] duration-200 ease-out motion-reduce:transition-none motion-reduce:duration-0",
    ringClass,
    Z_INDEX[index],
    index > 0 && "-ml-3 group-hover:ml-1 group-focus-visible:ml-1",
  );

export function CoverStack({
  copies,
  label,
  ringClass,
}: {
  copies: readonly InboxContextCopy[];
  // Summary for assistive tech (coverStackSummary).
  label: string;
  // Separation ring in the row's background colour.
  ringClass: string;
}) {
  const visible = copies.slice(0, COVER_STACK_VISIBLE);
  const rest = copies.length - visible.length;
  return (
    <span
      role="group"
      aria-label={label}
      className="flex shrink-0 items-center"
    >
      {visible.map((copy, index) => (
        <span
          key={copy.copyId}
          title={copy.title}
          className={cn(
            tileClass(index, ringClass),
            "bg-muted hover:z-10 hover:-translate-y-0.5",
          )}
        >
          {copy.coverUrl ? (
            <Image
              src={copy.coverUrl}
              alt={copy.title}
              fill
              className="object-cover"
            />
          ) : (
            <span role="img" aria-label={copy.title} className="flex">
              <Puzzle
                aria-hidden
                className={cn(
                  "text-muted-foreground size-3.5",
                  // Behind the front tile only a sliver would show, so back
                  // glyph tiles read as plain cards until the stack spreads.
                  index > 0 &&
                    "opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none motion-reduce:duration-0",
                )}
              />
            </span>
          )}
        </span>
      ))}
      {rest > 0 && (
        // Beside the stack, never under it, so "+N" stays readable.
        <span className="bg-muted text-muted-foreground ml-1 flex h-6 min-w-6 shrink-0 items-center justify-center rounded-[5px] px-1 text-[11px] font-semibold tabular-nums -my-0.5">
          +{rest}
        </span>
      )}
    </span>
  );
}
