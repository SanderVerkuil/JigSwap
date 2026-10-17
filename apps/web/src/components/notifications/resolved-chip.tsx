import { cn } from "@/lib/utils";
import { CheckCircle2 } from "lucide-react";
import { useEffect, useRef } from "react";

/**
 * The outcome of a notification's decision ("Approved", "Requested", ...), announced as a status.
 * `focusOnMount` moves focus to it after the viewer acted, so keyboard users don't lose their place
 * when the buttons they used disappear.
 */
export function ResolvedChip({
  label,
  focusOnMount = false,
}: {
  label: string;
  focusOnMount?: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (focusOnMount) ref.current?.focus();
  }, [focusOnMount]);

  return (
    <span
      ref={ref}
      role="status"
      tabIndex={-1}
      className={cn(
        "bg-muted text-muted-foreground inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium outline-none",
        "focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        "animate-in fade-in-0 motion-reduce:animate-none",
      )}
    >
      <CheckCircle2 className="size-3.5" aria-hidden="true" />
      {label}
    </span>
  );
}
