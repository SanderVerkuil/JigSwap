"use client";

// Shared design-language primitives for the Community screens (Browse,
// Circles, Exchanges, Messages, People), per the JigSwap design handoff:
// rounded-full filter pills with a muted result count, warm 🧩 empty states,
// gradient icon cover chips, and big-number-over-muted-label mini stats.
// Open, card-free building blocks — cards stay reserved for genuinely
// self-contained tiles.

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/* ------------------------------------------------------------ FilterBar */

// A row of rounded-full filter pills (active pill in the brand color) with an
// optional muted count on the right and an extra slot for secondary controls.
export function FilterBar<T extends string>({
  filters,
  value,
  onChange,
  count,
  extra,
  className,
}: {
  filters: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  count?: ReactNode;
  extra?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3",
        className,
      )}
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
              onClick={() => onChange(filter.value)}
              className={cn(
                "rounded-full",
                active &&
                  "bg-jigsaw-primary text-white hover:bg-jigsaw-primary/90",
              )}
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

// The warm 🧩 empty state: emoji, heading-font title, muted one-liner.
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
      <div className="mb-2 text-[34px] leading-none" aria-hidden>
        🧩
      </div>
      <div className="font-heading text-foreground text-lg font-bold">
        {title}
      </div>
      {sub && <p className="mt-0.5 text-sm">{sub}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* ------------------------------------------------------------- CoverChip */

// Warm brand gradient pairs (violet / green / pink / amber) reused from the
// dashboard shelf so chips never read as empty gray boxes.
export const CHIP_GRADIENTS: ReadonlyArray<readonly [string, string]> = [
  ["#6048e8", "#494e92"],
  ["#3fae3c", "#157a13"],
  ["#ec4899", "#b22d6e"],
  ["#f5a623", "#cf7911"],
];

// A gradient icon chip used as the leading "cover" of an open row tile.
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
  const [c1, c2] = CHIP_GRADIENTS[gradientIndex % CHIP_GRADIENTS.length];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-lg text-white shadow-[inset_0_0_0_1px_rgb(0_0_0/0.08)]",
        className,
      )}
      style={{
        width: size,
        height: size,
        background: `linear-gradient(150deg, ${c1}, ${c2})`,
      }}
    >
      <Icon style={{ width: size * 0.42, height: size * 0.42 }} />
    </span>
  );
}

/* -------------------------------------------------------------- MiniStat */

// A big heading-font number over a muted label, for compact stat clusters on
// row tiles (e.g. members / shared on a circle row).
export function MiniStat({
  value,
  label,
  className,
}: {
  value: ReactNode;
  label: string;
  className?: string;
}) {
  return (
    <div className={cn("min-w-14 text-center", className)}>
      <div className="font-heading text-foreground text-xl leading-none font-bold">
        {value}
      </div>
      <div className="text-muted-foreground mt-1 text-xs">{label}</div>
    </div>
  );
}
