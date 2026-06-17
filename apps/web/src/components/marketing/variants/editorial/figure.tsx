import { cn } from "@/lib/utils";

// A single big-number editorial figure. The giant numeral is decorative scale
// (aria-hidden); the sr-only <figcaption> carries the real meaning for screen
// readers. While loading we show a pulsing bar placeholder — never "0".
export function Figure({
  value,
  caption,
  sentence,
  loading,
  className,
}: {
  value: string;
  caption: string;
  /** Full sentence for screen readers, e.g. "312 puzzles in circulation". */
  sentence: string;
  loading: boolean;
  className?: string;
}) {
  return (
    <figure className={cn("px-[clamp(16px,4vw,40px)]", className)}>
      {loading ? (
        <div
          aria-hidden="true"
          className="h-[clamp(52px,9vw,128px)] flex items-end"
        >
          <span className="block w-[60%] h-[0.62em] rounded-[2px] bg-mk-border animate-pulse" />
        </div>
      ) : (
        <div aria-hidden="true" className="ed-figure">
          {value}
        </div>
      )}
      <div
        aria-hidden="true"
        className="ed-mono mt-3 text-[12px] font-semibold tracking-[0.16em] uppercase text-mk-text-muted"
      >
        {caption}
      </div>
      <figcaption className="sr-only">
        {loading ? `Loading ${caption}` : sentence}
      </figcaption>
    </figure>
  );
}
