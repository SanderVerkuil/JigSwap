// apps/web/src/components/add-puzzle/segmented-pills.tsx
import { useRef } from "react";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  dot?: string;
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
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const move = (from: number, delta: number) => {
    const next = (from + delta + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="flex flex-wrap gap-2"
    >
      {options.map((o, i) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                e.preventDefault();
                move(i, 1);
              } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                e.preventDefault();
                move(i, -1);
              }
            }}
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
