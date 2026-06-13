// apps/web/src/components/add-puzzle/availability-chips.tsx
import { Check, Plus } from "lucide-react";
import type { Availability } from "./add-puzzle-mappers";

const CHIPS: ReadonlyArray<{ key: keyof Availability; label: string }> = [
  { key: "forTrade", label: "For Trade" },
  { key: "forLend", label: "For Lend" },
  { key: "forSale", label: "For Sale" },
];

export function AvailabilityChips({
  value,
  onChange,
}: {
  value: Availability;
  onChange: (v: Availability) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {CHIPS.map(({ key, label }) => {
        const on = value[key];
        return (
          <button
            key={key}
            type="button"
            aria-pressed={on}
            onClick={() => onChange({ ...value, [key]: !on })}
            className={[
              "inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-semibold cursor-pointer border transition-colors",
              on
                ? "bg-jigsaw-secondary-tint text-jigsaw-secondary border-jigsaw-secondary/40"
                : "bg-card text-foreground border-border hover:bg-accent",
            ].join(" ")}
          >
            {on ? (
              <Check className="size-3.5" />
            ) : (
              <Plus className="size-3.5" />
            )}
            {label}
          </button>
        );
      })}
    </div>
  );
}
