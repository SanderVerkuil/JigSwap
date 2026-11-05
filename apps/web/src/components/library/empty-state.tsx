import { cn } from "@/lib/utils";
import { Puzzle } from "lucide-react";
import type { ReactNode } from "react";

// Warm empty state: a puzzle piece, a friendly heading and a half-line of
// guidance — never a boxed gray card.
export function EmptyState({
  title,
  sub,
  action,
  subClassName,
}: {
  title: string;
  sub?: string;
  subClassName?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-1.5 py-14 text-center">
      <Puzzle aria-hidden className="text-primary-text mb-1 size-8" />
      <div className="font-heading text-lg">{title}</div>
      {sub && (
        <p
          className={cn("text-muted-foreground max-w-md text-sm", subClassName)}
        >
          {sub}
        </p>
      )}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
