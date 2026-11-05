"use client";

// Shared design-language primitives for the Community screens (Browse,
// Circles, Exchanges, Messages, People), per the JigSwap design handoff:
// filter buttons with a muted result count, warm puzzle-piece empty states
// and flat icon cover chips.
// Open, card-free building blocks — cards stay reserved for genuinely
// self-contained tiles.
import { chipColor } from "@/components/library/palette";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Puzzle, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/* ------------------------------------------------------------ FilterBar */

// A row of filter buttons (active one in the primary color) with an
// optional muted count on the right and an extra slot for secondary controls.
// A pill may carry its own tour anchor (`data-tour`) for a guide step about it.
export function FilterBar<T extends string>({
  filters,
  value,
  onChange,
  count,
  extra,
  className,
  "data-tour": dataTour,
}: {
  filters: ReadonlyArray<{ value: T; label: string; "data-tour"?: string }>;
  value: T;
  onChange: (value: T) => void;
  count?: ReactNode;
  extra?: ReactNode;
  className?: string;
  /** Tour anchor (components/tour). */
  "data-tour"?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3",
        className,
      )}
      data-tour={dataTour}
    >
      <div className="flex flex-wrap items-center gap-2">
        {filters.map((filter) => {
          const active = filter.value === value;
          return (
            <Button
              key={filter.value}
              type="button"
              size="sm"
              variant={active ? "default" : "outline"}
              aria-pressed={active}
              data-tour={filter["data-tour"]}
              onClick={() => onChange(filter.value)}
            >
              {filter.label}
            </Button>
          );
        })}
      </div>
      <div className="flex items-center gap-3">
        {extra}
        {count != null && (
          <span className="text-muted-foreground text-sm">{count}</span>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ EmptyState */

// The warm empty state: puzzle piece, heading-font title, muted one-liner.
export function EmptyState({
  title,
  sub,
  action,
  className,
}: {
  title: string;
  sub?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "text-muted-foreground flex flex-col items-center py-14 text-center",
        className,
      )}
    >
      <Puzzle aria-hidden className="text-primary-text mb-2 size-8" />
      <div className="font-heading text-foreground text-lg">{title}</div>
      {sub && <p className="mt-0.5 text-sm">{sub}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* ------------------------------------------------------------- CoverChip */

// A flat icon chip used as the leading "cover" of an open row tile, in a world
// colour so it never reads as an empty gray box.
export function CoverChip({
  icon: Icon,
  size = 44,
  gradientIndex = 0,
  className,
}: {
  icon: LucideIcon;
  size?: number;
  gradientIndex?: number;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-lg text-white",
        className,
      )}
      style={{
        width: size,
        height: size,
        background: chipColor(gradientIndex),
      }}
    >
      <Icon style={{ width: size * 0.42, height: size * 0.42 }} />
    </span>
  );
}
