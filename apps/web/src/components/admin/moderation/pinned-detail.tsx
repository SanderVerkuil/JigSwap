"use client";

// The detail pane's frame for a pinned queue selection (use-pinned-selection.ts). When the
// selected row has left the queue without this reviewer deciding it, a banner says it was handled
// elsewhere and offers the next row, above the last-seen snapshot (which the caller renders with
// its actions disabled). Otherwise it renders the detail as is.
import { Button } from "@/components/ui/button";
import { ArrowRight, CircleCheck } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslations } from "use-intl";

export function PinnedDetail({
  gone,
  onNext,
  children,
}: {
  gone: boolean;
  /** Moves to the next row; omitted when there is none. */
  onNext?: () => void;
  children?: ReactNode;
}) {
  const t = useTranslations("admin.moderation.handledElsewhere");
  if (!gone) return children;
  return (
    <div className="flex flex-col gap-5">
      <div
        role="status"
        className="flex flex-wrap items-start gap-3 rounded-lg border bg-muted/60 px-3.5 py-3"
      >
        <CircleCheck
          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{t("title")}</p>
          <p className="text-sm">{t("body")}</p>
        </div>
        {onNext && (
          <Button size="sm" className="h-11 md:h-8" onClick={onNext}>
            {t("next")}
            <ArrowRight aria-hidden />
          </Button>
        )}
      </div>
      {children}
    </div>
  );
}
