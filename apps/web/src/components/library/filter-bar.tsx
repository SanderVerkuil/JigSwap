import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export interface FilterOption<T extends string> {
  value: T;
  label: string;
}

// Single-choice filters sit in the tab track: a muted 6px track whose chosen option is a window at
// 600, edged in Canal Link (Night Link after dark). White on the track alone is 1.1:1, so the edge
// is what shows the choice. It is an inset ring so it never thins the 2px focus ring. Selection
// never takes the canal fill, which belongs to actions.
export const TOGGLE_TRACK =
  "inline-flex w-fit flex-wrap gap-0.5 rounded-lg bg-muted p-[3px]";

/** Classes for one option in a TOGGLE_TRACK, rendered as a ghost `sm` Button. */
export function toggleOption(active: boolean) {
  return cn(
    active &&
      "bg-background text-foreground font-semibold hover:bg-background dark:hover:bg-background inset-ring inset-ring-primary-text",
  );
}

// A row of single-choice filters in the tab track, with a muted result count right-aligned on
// the same line.
export function FilterBar<T extends string>({
  options,
  value,
  onChange,
  count,
  className,
  pillsClassName,
  countClassName,
  label,
}: {
  options: FilterOption<T>[];
  value: T;
  onChange: (value: T) => void;
  count?: ReactNode;
  className?: string;
  pillsClassName?: string;
  countClassName?: string;
  /** Names the group for screen readers when no visible heading does. */
  label?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3",
        className,
      )}
    >
      <div
        className={cn(TOGGLE_TRACK, pillsClassName)}
        role="group"
        aria-label={label}
      >
        {options.map((option) => {
          const active = value === option.value;
          return (
            <Button
              key={option.value}
              type="button"
              size="sm"
              variant="ghost"
              aria-pressed={active}
              className={toggleOption(active)}
              onClick={() => onChange(option.value)}
            >
              {option.label}
            </Button>
          );
        })}
      </div>
      {count && (
        <span className={cn("text-muted-foreground text-sm", countClassName)}>
          {count}
        </span>
      )}
    </div>
  );
}
