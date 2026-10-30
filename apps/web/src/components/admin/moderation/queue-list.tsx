"use client";

// Generic list+detail split for the moderation queues (submissions, flagged
// photos, unchecked photos): a bordered column of full-width row buttons and
// the selected row's detail. The rows' content is entirely the caller's
// (renderRow); this component owns only selection presentation and the
// responsive split:
// - from lg (1024px) the detail sits next to the list and sticks below the
//   tab bar, scrolling on its own, so it stays in view however far down the
//   list the reviewer selects;
// - below lg (every tablet and phone) a row opens the detail in a Sheet, as
//   the Reports tab does, instead of rendering it after the whole list.
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useMinWidth } from "@/hooks/use-min-width";
import { cn } from "@/lib/utils";
import { useState, type ReactNode } from "react";

// Tailwind's lg breakpoint, where the side-by-side split starts.
const LG = "64rem";

export function QueueList<T>({
  items,
  selectedId,
  onSelect,
  getId,
  renderRow,
  detail,
  detailTitle,
  defaultDetailOpen = false,
}: {
  items: T[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  getId: (item: T) => string;
  renderRow: (item: T) => ReactNode;
  detail: ReactNode;
  /** The Sheet's title below lg (e.g. "Submission"). */
  detailTitle: string;
  /** Below lg, open the Sheet on mount (a link straight to an item). */
  defaultDetailOpen?: boolean;
}) {
  const wide = useMinWidth(LG);
  const [sheetOpen, setSheetOpen] = useState(defaultDetailOpen);

  const select = (id: string) => {
    onSelect(id);
    if (!wide) setSheetOpen(true);
  };

  return (
    <div className="flex flex-col items-start gap-4 lg:grid lg:grid-cols-[360px_1fr]">
      <div className="w-full self-stretch overflow-hidden rounded-xl border bg-card lg:self-start">
        {items.map((item) => {
          const id = getId(item);
          const active = id === selectedId;
          return (
            <button
              key={id}
              type="button"
              onClick={() => select(id)}
              aria-current={active}
              className={cn(
                "flex w-full items-center gap-3 border-b border-l-2 px-3 py-3 text-left last:border-b-0",
                active
                  ? "border-l-primary bg-primary/5"
                  : "border-l-transparent hover:bg-accent/50",
              )}
            >
              {renderRow(item)}
            </button>
          );
        })}
      </div>
      {wide ? (
        // Sticks below the sticky tab bar (--app-sticky-top + its ~44px height + a gap) and
        // scrolls on its own when taller than what is left of the scroll region.
        <div className="w-full min-w-0 rounded-xl border bg-card p-5 lg:sticky lg:top-[calc(var(--app-sticky-top,0px)+3.5rem)] lg:max-h-[calc(100svh-var(--app-sticky-top,0px)-8.5rem)] lg:self-start lg:overflow-y-auto">
          {detail}
        </div>
      ) : (
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetContent
            className="w-full overflow-y-auto sm:max-w-xl"
            aria-describedby={undefined}
          >
            <SheetHeader className="px-5 pb-0">
              <SheetTitle>{detailTitle}</SheetTitle>
            </SheetHeader>
            <div className="px-5 pb-5">{detail}</div>
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
