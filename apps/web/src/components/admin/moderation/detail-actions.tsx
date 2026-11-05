import type { ReactNode } from "react";

// The decision buttons of a queue's detail pane. They stick to the bottom of whatever scrolls the
// pane (its own overflow from lg, the Sheet below it), so a tall item never puts them behind a
// second scroll. Bleeds over the pane's padding (p-5 / px-5 pb-5 in queue-list.tsx) so the row
// reads as the pane's footer. queue-list.tsx sets --detail-bg to the pane's background, and
// --detail-stick to how far past its scroll box's padding the row sticks: the pane from lg scrolls
// itself, so sticking at 0 would leave its bottom padding open with content showing below the row.
export function DetailActions({ children }: { children: ReactNode }) {
  return (
    <div
      data-detail-actions
      className="sticky bottom-[var(--detail-stick,0px)] z-10 -mx-5 -mb-5 flex flex-wrap items-center gap-2.5 border-t bg-[var(--detail-bg,var(--card))] px-5 py-3"
    >
      {children}
    </div>
  );
}
