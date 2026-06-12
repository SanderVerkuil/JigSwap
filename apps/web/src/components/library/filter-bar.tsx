import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export interface FilterOption<T extends string> {
  value: T;
  label: string;
}

// Rounded-pill filter row from the design language: active pill solid primary,
// inactive pills outlined on the card surface, with a muted result count
// right-aligned on the same line.
export function FilterBar<T extends string>({
  options,
  value,
  onChange,
  count,
  className,
}: {
  options: FilterOption<T>[];
  value: T;
  onChange: (value: T) => void;
  count?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3",
        className,
      )}
    >
      <div className="flex flex-wrap gap-2" role="group">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-sm font-medium whitespace-nowrap transition-colors",
              value === option.value
                ? "border-transparent bg-primary text-primary-foreground"
                : "bg-card hover:bg-accent text-foreground",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
      {count && <span className="text-muted-foreground text-sm">{count}</span>}
    </div>
  );
}
