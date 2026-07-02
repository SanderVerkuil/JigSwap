"use client";

// Generic list+detail split for the moderation queues (submissions now,
// flagged photos in the follow-up): a bordered column of full-width row
// buttons next to a detail pane on lg+, stacked list-above-detail below.
// The rows' content is entirely the caller's (renderRow); this component
// owns only selection state presentation and the responsive split.

import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export function QueueList<T>({
  items,
  selectedId,
  onSelect,
  getId,
  renderRow,
  detail,
}: {
  items: T[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  getId: (item: T) => string;
  renderRow: (item: T) => ReactNode;
  detail: ReactNode;
}) {
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
              onClick={() => onSelect(id)}
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
      <div className="w-full min-w-0 rounded-xl border bg-card p-5">
        {detail}
      </div>
    </div>
  );
}
