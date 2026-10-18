"use client";

// Puzzle cover tiles for the messaging surfaces: the shared 24px tile (cover
// image, or the puzzle glyph on a muted card with a hairline edge), the
// tooltip provider their names share, and the inbox row's single cover (the
// conversation's most recent puzzle). The thread header's stack of all the
// conversation's puzzles lives in thread-puzzle-stack.tsx.
import { Image } from "@/compat/image";
import { TooltipContent } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { Puzzle } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { InboxContextCopy } from "./format";

// One cover. `glyphShifted`: the tile's left half is covered by the card in
// front of it, so the glyph moves into the visible right half.
export function CoverTile({
  copy,
  className,
  glyphShifted = false,
}: {
  copy: InboxContextCopy;
  className?: string;
  glyphShifted?: boolean;
}) {
  return (
    <span
      className={cn(
        // A hairline edge so each card in a stack reads as its own puzzle.
        "bg-muted border-foreground/20 relative flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-[5px] border",
        className,
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
              "text-muted-foreground size-3.5 transition-transform duration-200 motion-reduce:transition-none motion-reduce:duration-0",
              glyphShifted && "translate-x-1",
            )}
          />
        </span>
      )}
    </span>
  );
}

// The name tooltip for one cover: portalled (row/list/header overflow can't
// clip it), clear of the screen edge, and it simply appears under
// prefers-reduced-motion.
export function CoverTooltipContent({ children }: { children: ReactNode }) {
  return (
    <TooltipContent
      side="top"
      sideOffset={6}
      collisionPadding={8}
      className="max-w-[min(18rem,calc(100vw-2rem))] motion-reduce:animate-none"
    >
      {children}
    </TooltipContent>
  );
}

// Shared tooltip delays: a short first delay, then instant hand-off while the
// pointer sweeps from cover to cover.
export function CoverTooltipProvider({ children }: { children: ReactNode }) {
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

// An inbox row's puzzle: the most recent one only, as a single cover at the
// start of the row's second line. It lifts and names itself ("<title> ·
// <whose copy>") on hover, or when the row has keyboard focus. Purely
// presentational inside the row link: `label` (all the thread's puzzles,
// summarised) is what the link announces.
export function RowCover({
  copy,
  label,
  describe,
  keyboardFocused,
}: {
  copy: InboxContextCopy;
  label: string;
  describe: (copy: InboxContextCopy) => string;
  keyboardFocused: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <span role="group" aria-label={label} className="flex shrink-0">
      <TooltipPrimitive.Root
        open={hovered || keyboardFocused}
        onOpenChange={setHovered}
      >
        <TooltipPrimitive.Trigger asChild>
          <span className="-my-0.5 flex transition-transform duration-200 ease-out group-focus-visible:-translate-y-0.5 hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:duration-0">
            <CoverTile copy={copy} />
          </span>
        </TooltipPrimitive.Trigger>
        <CoverTooltipContent>{describe(copy)}</CoverTooltipContent>
      </TooltipPrimitive.Root>
    </span>
  );
}
