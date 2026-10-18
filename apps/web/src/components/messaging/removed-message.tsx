"use client";

// A moderator-removed message's placeholder: the bubble's geometry, dashed
// and muted, non-interactive, with no actions. The server already blanks the
// body; this never renders it. The group's time row sits under it as under
// any bubble.
import { cn } from "@/lib/utils";
import { useTranslations } from "use-intl";

export function RemovedMessage({
  title,
  className,
}: {
  /** The full send date and time, as a bubble's tooltip. */
  title: string;
  className?: string;
}) {
  const t = useTranslations("safety");
  return (
    <div
      title={title}
      className={cn(
        "text-muted-foreground max-w-[min(80%,30rem)] rounded-2xl border border-dashed px-3.5 py-2 text-sm leading-5 italic",
        className,
      )}
    >
      {t("messageRemoved")}
    </div>
  );
}
