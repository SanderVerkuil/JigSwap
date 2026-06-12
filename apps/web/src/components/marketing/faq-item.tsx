import { Plus } from "lucide-react";
import * as React from "react";

// Single FAQ accordion row: plus icon rotates to an ✕ when open.
export function FaqItem({
  q,
  a,
  last = false,
}: {
  q: string;
  a: string;
  last?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className={last ? "" : "border-b border-mk-border"}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-4 py-5 text-left cursor-pointer"
      >
        <span className="font-mk-heading font-semibold text-lg text-mk-text-strong">
          {q}
        </span>
        <span
          className="shrink-0 text-mk-violet-600 transition-transform duration-200"
          style={{ transform: open ? "rotate(45deg)" : "none" }}
        >
          <Plus size={20} />
        </span>
      </button>
      <div
        className="overflow-hidden transition-[max-height] duration-300 ease-mk-out"
        style={{ maxHeight: open ? 200 : 0 }}
      >
        <p className="text-base leading-relaxed text-mk-text-muted pr-10 pb-[22px]">
          {a}
        </p>
      </div>
    </div>
  );
}
