import type { ReactNode } from "react";

// Warm 🧩 empty state: the one sanctioned emoji, a friendly heading and a
// half-line of guidance — never a boxed gray card.
export function EmptyState({
  title,
  sub,
  action,
}: {
  title: string;
  sub?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-1.5 py-14 text-center">
      <div aria-hidden className="mb-1 text-[34px] leading-none">
        🧩
      </div>
      <div className="font-heading text-lg font-bold">{title}</div>
      {sub && <p className="text-muted-foreground text-sm">{sub}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
