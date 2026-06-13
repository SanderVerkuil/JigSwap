// apps/web/src/components/add-puzzle/availability-chips.tsx
import { Check, Plus } from "lucide-react";
import { useTranslations } from "use-intl";
import type { Availability } from "./add-puzzle-mappers";

type ChipKey = keyof Availability;

const CHIP_KEYS: ReadonlyArray<{ key: ChipKey; tKey: string }> = [
  { key: "forTrade", tKey: "availTrade" },
  { key: "forLend", tKey: "availLend" },
  { key: "forSale", tKey: "availSale" },
];

export function AvailabilityChips({
  value,
  onChange,
}: {
  value: Availability;
  onChange: (v: Availability) => void;
}) {
  const t = useTranslations("puzzles");
  return (
    <div className="flex flex-wrap gap-2">
      {CHIP_KEYS.map(({ key, tKey }) => {
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
            {t(tKey)}
          </button>
        );
      })}
    </div>
  );
}
