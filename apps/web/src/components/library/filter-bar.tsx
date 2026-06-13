import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export interface FilterOption<T extends string> {
  value: T;
  label: string;
}

// Rounded-pill filter row from the design language, built on the themed shadcn
// Button: the active pill takes the brand violet, inactive pills are outlined,
// with a muted result count right-aligned on the same line.
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
        {options.map((option) => {
          const active = value === option.value;
          return (
            <Button
              key={option.value}
              type="button"
              size="sm"
              variant={active ? "default" : "outline"}
              aria-pressed={active}
              onClick={() => onChange(option.value)}
              className={cn(
                "rounded-full",
                active &&
                  "bg-jigsaw-primary text-white hover:bg-jigsaw-primary/90",
              )}
            >
              {option.label}
            </Button>
          );
        })}
      </div>
      {count && <span className="text-muted-foreground text-sm">{count}</span>}
    </div>
  );
}
