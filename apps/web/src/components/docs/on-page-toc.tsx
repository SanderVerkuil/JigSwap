import type { DocHeading } from "@/docs/types";
import { cn } from "@/lib/utils";
import * as React from "react";
import { useTranslations } from "use-intl";

export function OnPageToc({
  headings,
  className,
}: {
  headings: DocHeading[];
  className?: string;
}) {
  const t = useTranslations("marketing.docs");
  const labelId = React.useId();
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
    <aside aria-labelledby={labelId} className={cn("self-start", className)}>
      <div
        id={labelId}
        className="font-mk-heading text-[17px] text-mk-text-strong mb-3"
      >
        {t("onThisPage")}
      </div>
      <nav aria-labelledby={labelId} className="flex flex-col gap-0.5">
        {headings.map((h) => (
          <a
            key={h.id}
            href={`#${h.id}`}
            aria-current={active === h.id ? "true" : undefined}
            className={cn(
              "py-[5px] px-2.5 rounded-sm text-[14px] leading-snug transition-colors duration-150",
              h.depth === 3 && "pl-5",
              active === h.id
                ? "bg-mk-sky-soft dark:bg-mk-muted text-mk-text-strong font-semibold"
                : "text-mk-text-muted hover:text-mk-text-strong",
            )}
          >
            {h.text}
          </a>
        ))}
      </nav>
    </aside>
  );
}
