// apps/web/src/components/add-puzzle/segmented-pills.tsx
export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  dot?: string; // tailwind bg-* class for the leading dot
}

export function SegmentedPills<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (v: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="flex flex-wrap gap-2"
    >
      {options.map((o) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={[
              "inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-semibold cursor-pointer border transition-colors",
              on
                ? "bg-primary text-primary-foreground border-transparent"
                : "bg-card text-foreground border-border hover:bg-accent",
            ].join(" ")}
          >
            {o.dot && (
              <span
                className={[
                  "size-2.5 rounded-[3px]",
                  on ? "bg-white" : o.dot,
                ].join(" ")}
              />
            )}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
