import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

// Card-free section heading: an icon + Title Case h2 over a thin rule, with
// optional right-aligned meta text and an action slot. This is the open layout
// language from the design system — sections separated by whitespace and
// hairline rules instead of boxed cards.
export function SectionHead({
  title,
  icon: Icon,
  meta,
  action,
  className,
  headingProps,
}: {
  title: string;
  icon?: LucideIcon;
  meta?: ReactNode;
  action?: ReactNode;
  className?: string;
  // Passed to the h2, e.g. an id and tabIndex={-1} so focus can be moved to the heading.
  headingProps?: ComponentProps<"h2">;
}) {
  return (
    <div
      className={cn(
        "mb-5 flex items-baseline justify-between gap-3 border-b pb-2.5",
        className,
      )}
    >
      <h2
        {...headingProps}
        className={cn(
          "font-heading flex items-center gap-2 text-xl font-semibold whitespace-nowrap",
          headingProps?.className,
        )}
      >
        {Icon && <Icon className="text-jigsaw-primary size-[18px]" />}
        {title}
      </h2>
      <div className="flex min-w-0 items-center gap-3.5">
        {meta && (
          <span className="text-muted-foreground truncate text-right text-sm">
            {meta}
          </span>
        )}
        {action}
      </div>
    </div>
  );
}
