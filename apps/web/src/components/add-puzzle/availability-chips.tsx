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
  isLocked,
}: {
  value: Availability;
  onChange: (v: Availability) => void;
  /** An offer that can't be changed right now. */
  isLocked?: (offer: ChipKey) => boolean;
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
            disabled={isLocked?.(key) ?? false}
            onClick={() => onChange({ ...value, [key]: !on })}
            className={[
              "inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-sm font-semibold cursor-pointer border transition-colors disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:min-h-11",
              on
                ? "bg-jigsaw-secondary-tint text-jigsaw-secondary-text border-jigsaw-secondary/40"
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
