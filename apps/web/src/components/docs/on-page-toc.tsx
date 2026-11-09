import type { DocHeading } from "@/docs/types";
import { isPlainClick, useActiveHeading } from "@/hooks/use-active-heading";
import { cn } from "@/lib/utils";
import { ChevronDown, TableOfContents } from "lucide-react";
import * as React from "react";
import { useTranslations } from "use-intl";

// The folded variant's id, which OnThisPageLink jumps back to.
const ON_THIS_PAGE_ID = "on-this-page";

// The article's headings: a sticky rail beside the text, or (where the rail doesn't fit) a
// collapsible block under the title.
export function OnPageToc({
  headings,
  variant = "rail",
  className,
}: {
  headings: DocHeading[];
  variant?: "rail" | "details";
  className?: string;
}) {
  const t = useTranslations("marketing.docs");
  const labelId = React.useId();
  const [active, pick] = useActiveHeading(headings);

  if (headings.length === 0) return null;
  const links = headings.map((h) => (
    <a
      key={h.id}
      href={`#${h.id}`}
      onClick={(e) => {
        if (isPlainClick(e)) pick(h.id);
      }}
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
  ));

  if (variant === "details") {
    return (
      <details
        id={ON_THIS_PAGE_ID}
        className={cn(
          "group bg-mk-muted dark:bg-mk-card scroll-mt-4 rounded-md",
          className,
        )}
      >
        <summary className="font-mk-heading text-mk-text-strong focus-visible:ring-mk-ring flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-md px-4 text-[18px] font-normal focus-visible:ring-2 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
          {t("onThisPage")}
          <ChevronDown
            size={18}
            aria-hidden="true"
            className="transition-transform group-open:rotate-180 motion-reduce:transition-none"
          />
        </summary>
        <nav
          aria-label={t("onThisPage")}
          className="flex flex-col gap-0.5 px-4 pb-3"
        >
          {links}
        </nav>
      </details>
    );
  }

  return (
    <aside aria-labelledby={labelId} className={cn("self-start", className)}>
      <div
        id={labelId}
        className="font-mk-heading text-[17px] text-mk-text-strong mb-3"
      >
        {t("onThisPage")}
      </div>
      <nav aria-labelledby={labelId} className="flex flex-col gap-0.5">
        {links}
      </nav>
    </aside>
  );
}

// Back to the article's folded contents from anywhere in a long page, for the phone Docs bar and the
// sidebar: a plain jump to its hash that opens it on the way. Hidden on pages without one (the
// landing, pages without headings); the class names the id literally so Tailwind can see it.
export function OnThisPageLink({ className }: { className?: string }) {
  const t = useTranslations("marketing.docs");
  return (
    <a
      href={`#${ON_THIS_PAGE_ID}`}
      onClick={() => {
        const contents = document.getElementById(ON_THIS_PAGE_ID);
        if (contents instanceof HTMLDetailsElement) contents.open = true;
      }}
      className={cn(className, "[body:not(:has(#on-this-page))_&]:hidden")}
    >
      <TableOfContents className="size-4 shrink-0" aria-hidden="true" />
      {t("onThisPage")}
    </a>
  );
}
