import { UnreadDot } from "@/components/whats-new/badges";
import { cn } from "@/lib/utils";
import type { QuickStartStepView } from "@jigswap/contracts";
import { Check, Minus } from "lucide-react";
import { useTranslations } from "use-intl";
import { displayCount, rowState, type RowState } from "./logic";

// The primary-action look shared with the What's new highlight and the tour card (spec §5).
export const PRIMARY_LOOK =
  "bg-jigsaw-primary hover:bg-jigsaw-primary/90 text-white pointer-coarse:min-h-11";

// The eyebrow shared with the tour card and the highlight modal.
export const EYEBROW =
  "text-muted-foreground font-mono text-[11px] tracking-[0.09em] uppercase";

/**
 * The four-segment progress bar (D9), one segment per required step. One element with
 * role="progressbar", labelled by the surrounding heading; the segments are decorative.
 */
export function QuickStartProgress({
  segments,
  labelledBy,
}: {
  segments: readonly boolean[];
  labelledBy: string;
}) {
  const t = useTranslations("quickStart.card");
  const done = segments.filter(Boolean).length;
  return (
    <div
      role="progressbar"
      aria-labelledby={labelledBy}
      aria-valuemin={0}
      aria-valuemax={segments.length}
      aria-valuenow={done}
      aria-valuetext={t("progressLabel", { done, total: segments.length })}
      className="flex gap-1"
    >
      {segments.map((on, i) => (
        <span
          key={i}
          aria-hidden
          className={cn(
            "h-1.5 flex-1 rounded-full transition-colors motion-reduce:transition-none",
            on ? "bg-primary" : "bg-muted",
          )}
        />
      ))}
    </div>
  );
}

/** A step's state marker (§5.2): number, check, dash or ring; always aria-hidden. */
export function StepMarker({
  state,
  number,
  pending = false,
}: {
  state: RowState;
  number: number;
  pending?: boolean;
}) {
  const base =
    "relative flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold";
  if (state === "done") {
    return (
      <span
        aria-hidden
        className={cn(
          base,
          "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200",
        )}
      >
        <Check className="size-3.5" />
      </span>
    );
  }
  if (state === "skipped") {
    return (
      <span
        aria-hidden
        className={cn(
          base,
          "border-muted-foreground text-muted-foreground border-2 border-dashed",
        )}
      >
        <Minus className="size-3.5" />
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        base,
        "border-2",
        state === "inProgress"
          ? "border-primary text-primary dark:text-foreground"
          : "border-border text-foreground",
      )}
    >
      {number}
      {pending && (
        <UnreadDot className="ring-background -top-0.5 -right-0.5 size-2.5 ring-2" />
      )}
    </span>
  );
}

/** The step's title and its row sub-line for the card (§2.4, §5.2). */
export function useStepText() {
  const t = useTranslations("quickStart");
  const title = (id: QuickStartStepView["id"]) => t(`steps.${id}.title`);
  const subLine = (step: QuickStartStepView): string | undefined => {
    const state = rowState(step);
    const count = displayCount(step.count);
    if (state === "skipped") {
      return `${t("card.skipped")} · ${t("card.doItNow")}`;
    }
    if (state === "inProgress") {
      return t("card.continue", {
        progress: t("steps.puzzles.partial", { count }),
      });
    }
    if (state === "done") {
      switch (step.id) {
        case "puzzles":
          return t("steps.puzzles.count", { count });
        case "solves":
          return t("steps.solves.count", { count });
        case "people":
          // Done through a pending follow request alone: there is no follow to count yet.
          return step.count ? t("steps.people.count", { count }) : undefined;
        case "household":
          return t("steps.household.done");
        case "profile":
          return t("steps.profile.done");
      }
    }
    return step.pendingInvite ? t("steps.household.pending") : undefined;
  };
  return { title, subLine };
}
