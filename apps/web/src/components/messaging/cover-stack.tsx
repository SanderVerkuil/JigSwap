"use client";

// The puzzles an inbox row is about, as a fanned stack of small covers at the
// start of the row's second line (same 20px line box as the snippet beside
// it). The first cover sits on top, each next one slightly behind; hovering or
// keyboard-focusing the row spreads them apart, and the cover under the
// pointer lifts and names itself in a tooltip ("<title> · <whose copy>"; on
// keyboard focus the front cover does). Purely presentational inside the row
// link: the group's summary label ("About 5 puzzles: A, B, C and 2 more") is
// what the link announces, and each cover keeps its title as its name.
import { Image } from "@/compat/image";
import { TooltipContent } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { Puzzle } from "lucide-react";
import { useState, type ReactNode } from "react";
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
  describe,
  keyboardFocused,
}: {
  copies: readonly InboxContextCopy[];
  // Summary for assistive tech (coverStackSummary).
  label: string;
  // Separation ring in the row's background colour.
  ringClass: string;
  // Tooltip text for one cover: "<title> · <whose copy>".
  describe: (copy: InboxContextCopy) => string;
  // The row link has keyboard focus: the front cover lifts and shows its name.
  keyboardFocused: boolean;
}) {
  const visible = copies.slice(0, COVER_STACK_VISIBLE);
  const rest = copies.length - visible.length;
  // The cover whose tooltip the pointer opened (Radix applies the delays).
  const [hovered, setHovered] = useState<number | null>(null);
  const openIndex = hovered ?? (keyboardFocused ? 0 : null);
  return (
    <span
      role="group"
      aria-label={label}
      className="flex shrink-0 items-center"
    >
      {visible.map((copy, index) => (
        <TooltipPrimitive.Root
          key={copy.copyId}
          open={openIndex === index}
          onOpenChange={(open) =>
            setHovered((current) =>
              open ? index : current === index ? null : current,
            )
          }
        >
          <TooltipPrimitive.Trigger asChild>
            <span
              className={cn(
                tileClass(index, ringClass),
                // A hairline edge so each card in the deck reads as its own puzzle.
                "bg-muted border-foreground/20 border hover:z-10 hover:-translate-y-0.5",
                // Keyboard users get the same lift on the front cover.
                index === 0 && "group-focus-visible:-translate-y-0.5",
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
                      // Behind the front tile only the right half shows, so a back
                      // tile's glyph sits right of centre until the stack spreads.
                      index > 0 &&
                        "translate-x-1 transition-transform duration-200 group-hover:translate-x-0 group-focus-visible:translate-x-0 motion-reduce:transition-none motion-reduce:duration-0",
                    )}
                  />
                </span>
              )}
            </span>
          </TooltipPrimitive.Trigger>
          {/* Portalled, so the row/list overflow can't clip it; it just
              appears under prefers-reduced-motion. */}
          <TooltipContent
            side="top"
            sideOffset={6}
            // Keep clear of the screen edge on narrow viewports.
            collisionPadding={8}
            className="max-w-[min(18rem,calc(100vw-2rem))] motion-reduce:animate-none"
          >
            {describe(copy)}
          </TooltipContent>
        </TooltipPrimitive.Root>
      ))}
      {rest > 0 && (
        // Beside the stack, never under it, so "+N" stays readable.
        <span className="bg-muted text-muted-foreground -my-0.5 ml-1 flex h-6 min-w-6 shrink-0 items-center justify-center rounded-[5px] px-1 text-[11px] font-semibold tabular-nums">
          +{rest}
        </span>
      )}
    </span>
  );
}

// One provider per inbox list so tooltip delays are shared: a short first
// delay, then instant hand-off while the pointer sweeps across the stack.
export function CoverStackTooltipProvider({
  children,
}: {
  children: ReactNode;
}) {
  return (
    // disableHoverableContent: these tooltips are just names, and Radix's
    // grace area toward the (wide) tooltip would otherwise keep one cover's
    // name up while the pointer moves on to the next cover beneath it.
    <TooltipPrimitive.Provider
      delayDuration={200}
      skipDelayDuration={400}
      disableHoverableContent
    >
      {children}
    </TooltipPrimitive.Provider>
  );
}
