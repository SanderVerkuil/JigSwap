// Shared underline-style restyle of the boxed shadcn Tabs primitive: a transparent
// `TabsList` with a bottom border, and the active `TabsTrigger` gets a primary
// underline instead of the default boxed/shadowed look. `TabCount` is the small
// pill that follows a trigger's active state, for tabs that carry a live count.
// Used by the moderation console and the People page so both underline tab bars
// stay visually identical — extracted here rather than duplicated.

import { cn } from "@/lib/utils";
import type { ComponentProps } from "react";

// The bottom rule is an inset shadow rather than a border: the list scrolls sideways when it
// overflows (see tabs.tsx), and a scroll box clips its children to inside its border, so the
// active underline could no longer cover a real border. Triggers paint over an inset shadow.
export const UNDERLINE_TABS_LIST_CLASS =
  "h-auto w-full justify-start gap-1 rounded-none bg-transparent p-0 shadow-[inset_0_-1px_0_var(--border)]";

// Inset focus ring: an outset one would be clipped by the scrolling list.
export const TAB_TRIGGER_CLASS =
  "group flex-none gap-2 focus-visible:ring-inset rounded-none border-0 border-b-2 border-transparent px-4 py-2.5 font-semibold text-muted-foreground data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none dark:data-[state=active]:border-primary dark:data-[state=active]:bg-transparent";

export function TabCount({ count }: { count: number | undefined }) {
  if (count === undefined) return null;
  return (
    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-xs font-bold text-muted-foreground group-data-[state=active]:bg-primary group-data-[state=active]:text-primary-foreground">
      {count}
    </span>
  );
}

// Wraps a page's TabsList so the tab bar sticks just below the shell's sticky chrome
// (--app-sticky-top, set by the dashboard shell) while the tab's content scrolls under it. Opaque
// page background so nothing shows through; z-10 keeps it under the page head (z-20), the top
// bars (z-30) and every popover, menu and dialog (z-50).
export function StickyTabsBar({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "bg-background sticky top-[var(--app-sticky-top,0px)] z-10",
        className,
      )}
      {...props}
    />
  );
}
