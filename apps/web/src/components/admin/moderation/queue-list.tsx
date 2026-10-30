"use client";

// Generic list+detail split for the moderation queues (submissions, flagged
// photos, unchecked photos): a listbox of rows and the selected row's detail.
// The rows' content is entirely the caller's (renderRow); this component owns
// selection presentation, keyboard triage and the responsive split:
// - the rows are one `listbox` with a roving tab stop on the selected row:
//   Arrow Up/Down, Home and End move the selection (and focus) row by row, and
//   Enter/Space takes the reviewer into the detail;
// - the detail container (tabIndex -1, a region named after the queue) takes
//   focus whenever the route bumps `focusDetailToken` (after a decision), never
//   the next item's primary action, so a double Enter cannot approve the wrong
//   item;
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
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

// Tailwind's lg breakpoint, where the side-by-side split starts.
const LG = "64rem";

export function QueueList<T>({
  label,
  items,
  selectedId,
  onSelect,
  getId,
  renderRow,
  detail,
  detailTitle,
  focusDetailToken = 0,
  defaultDetailOpen = false,
}: {
  /** The listbox's accessible name (the queue's name). */
  label: string;
  items: T[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  getId: (item: T) => string;
  renderRow: (item: T) => ReactNode;
  detail: ReactNode;
  /** Names the detail region, and titles the Sheet below lg (e.g. "Submission"). */
  detailTitle: string;
  /** Each change (not the value on mount) moves focus to the detail container. */
  focusDetailToken?: number;
  /** Below lg, open the Sheet on mount (a link straight to an item). */
  defaultDetailOpen?: boolean;
}) {
  const wide = useMinWidth(LG);
  const [sheetOpen, setSheetOpen] = useState(defaultDetailOpen);
  const detailEl = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Focus the detail when the route asks (a token change after mount). The container outlives
  // the item it shows, so focus stays put while the next item renders into it.
  const [mountToken] = useState(focusDetailToken);
  useEffect(() => {
    if (focusDetailToken !== mountToken) detailEl.current?.focus();
  }, [focusDetailToken, mountToken]);

  // The row that holds the list's single Tab stop: the selection, else the first row.
  const tabStopId =
    selectedId !== null && items.some((item) => getId(item) === selectedId)
      ? selectedId
      : items.length > 0
        ? getId(items[0])
        : null;

  // A click (or tap) selects; below lg it also opens the Sheet.
  const select = (id: string) => {
    onSelect(id);
    if (!wide) setSheetOpen(true);
  };
  // Enter / Space: into the detail (focus it from lg; open the Sheet below).
  const activate = (id: string) => {
    onSelect(id);
    if (wide) detailEl.current?.focus();
    else setSheetOpen(true);
  };

  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const options = [
      ...(listRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ??
        []),
    ];
    const from = options.findIndex((option) =>
      option.contains(event.target as Node),
    );
    if (from === -1) return;
    const last = options.length - 1;
    const to =
      event.key === "ArrowDown"
        ? Math.min(from + 1, last)
        : event.key === "ArrowUp"
          ? Math.max(from - 1, 0)
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (to !== null) {
      event.preventDefault();
      const item = items[to];
      if (item === undefined) return;
      onSelect(getId(item));
      options[to]?.focus();
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const item = items[from];
      if (item !== undefined) activate(getId(item));
    }
  };

  const detailContainer = (className: string) => (
    <div
      ref={detailEl}
      role="region"
      aria-label={detailTitle}
      tabIndex={-1}
      className={cn(
        "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        className,
      )}
    >
      {detail}
    </div>
  );

  return (
    <div className="flex flex-col items-start gap-4 lg:grid lg:grid-cols-[360px_1fr]">
      <div
        ref={listRef}
        role="listbox"
        aria-label={label}
        onKeyDown={onListKeyDown}
        className="w-full self-stretch overflow-hidden rounded-xl border bg-card lg:self-start"
      >
        {items.map((item) => {
          const id = getId(item);
          const active = id === selectedId;
          return (
            <div
              key={id}
              role="option"
              aria-selected={active}
              tabIndex={id === tabStopId ? 0 : -1}
              onClick={() => select(id)}
              className={cn(
                // scroll-mt: a row focused by the arrow keys scrolls into view below the sticky
                // page head and tab bar, not under them.
                "flex w-full cursor-pointer scroll-mt-[calc(var(--app-sticky-top,0px)+3.5rem)] items-center gap-3 border-b border-l-2 px-3 py-3 text-left outline-none last:border-b-0 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset",
                active
                  ? "border-l-primary bg-primary/5"
                  : "border-l-transparent hover:bg-accent/50",
              )}
            >
              {renderRow(item)}
            </div>
          );
        })}
      </div>
      {wide ? (
        // Sticks below the sticky tab bar (--app-sticky-top + its ~44px height + a gap) and
        // scrolls on its own when taller than what is left of the scroll region.
        detailContainer(
          "w-full min-w-0 rounded-xl border bg-card p-5 lg:sticky lg:top-[calc(var(--app-sticky-top,0px)+3.5rem)] lg:max-h-[calc(100svh-var(--app-sticky-top,0px)-8.5rem)] lg:self-start lg:overflow-y-auto",
        )
      ) : (
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetContent
            className="w-full overflow-y-auto sm:max-w-xl"
            aria-describedby={undefined}
            // Land on the detail itself, not its first button (Approve): a second Enter must
            // never decide the item.
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              detailEl.current?.focus();
            }}
          >
            <SheetHeader className="px-5 pb-0">
              <SheetTitle>{detailTitle}</SheetTitle>
            </SheetHeader>
            {detailContainer("px-5 pb-5")}
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
