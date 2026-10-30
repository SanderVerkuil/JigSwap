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
 * role="progressbar", labelled by the surrounding heading; the segments are decorative. Filled
 * segments are done; in the flow, `current` (0-based) rings the segment of the step on screen,
 * so "Step 2 of 4" never sits over an unmarked bar (the gap widens so the ring stays clear).
 */
export function QuickStartProgress({
  segments,
  current,
  labelledBy,
}: {
  segments: readonly boolean[];
  current?: number;
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
      className={cn("flex gap-1", current !== undefined && "gap-1.5")}
    >
      {segments.map((on, i) => (
        <span
          key={i}
          aria-hidden
          className={cn(
            "h-1.5 flex-1 rounded-full transition-colors motion-reduce:transition-none",
            on ? "bg-primary" : "bg-muted",
            i === current &&
              "ring-primary ring-offset-background ring-2 ring-offset-1",
          )}
        />
      ))}
    </div>
  );
}

/**
 * A step's state marker (§5.2): number, check, dash or ring; always aria-hidden. `number` is the
 * step's stepPosition; the optional household has none, so its open marker is an empty ring.
 */
export function StepMarker({
  state,
  number,
  pending = false,
}: {
  state: RowState;
  number?: number;
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
          // A household of one is done (the step is optional), but nobody shares the shelf yet.
          return step.count === 1
            ? t("steps.household.justYou")
            : t("steps.household.done");
        case "profile":
          return t("steps.profile.done");
      }
    }
    return step.pendingInvite ? t("steps.household.pending") : undefined;
  };
  return { title, subLine };
}
