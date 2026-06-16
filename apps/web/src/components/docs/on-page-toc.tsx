import type { DocHeading } from "@/docs/types";
import { cn } from "@/lib/utils";
import * as React from "react";

export function OnPageToc({
  headings,
  className,
}: {
  headings: DocHeading[];
  className?: string;
}) {
  const [active, setActive] = React.useState(headings[0]?.id);
  React.useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => e.isIntersecting && setActive(e.target.id)),
      { rootMargin: "-30% 0px -60% 0px" },
    );
    headings.forEach((h) => {
      const el = document.getElementById(h.id);
      if (el) obs.observe(el);
    });
    return () => obs.disconnect();
  }, [headings]);

  if (headings.length === 0) return null;
  return (
    <aside className={cn("self-start", className)}>
      <div className="font-mono text-[11px] font-bold tracking-[.1em] uppercase text-mk-text-muted mb-3.5">
        On this page
      </div>
      <nav className="flex flex-col gap-0.5 border-l border-mk-border">
        {headings.map((h) => (
          <a
            key={h.id}
            href={`#${h.id}`}
            aria-current={active === h.id ? "true" : undefined}
            className={cn(
              "py-[6px] px-3.5 -ml-px border-l-2 text-[13px] leading-snug transition-colors",
              h.depth === 3 && "pl-6",
              active === h.id
                ? "border-mk-violet-400 text-mk-violet-600 font-semibold"
                : "border-transparent text-mk-text-muted hover:text-mk-text-body",
            )}
          >
            {h.text}
          </a>
        ))}
      </nav>
    </aside>
  );
}
