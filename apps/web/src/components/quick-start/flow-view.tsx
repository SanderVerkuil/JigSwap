"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { QuickStartStepId, QuickStartView } from "@jigswap/contracts";
import { Link } from "@tanstack/react-router";
import { Loader2, Puzzle } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "use-intl";
import {
  displayCount,
  isTextEntry,
  openRequiredSteps,
  progressSegments,
  rowState,
  stepPosition,
} from "./logic";
import {
  EYEBROW,
  PRIMARY_LOOK,
  QuickStartProgress,
  StepMarker,
  useStepText,
} from "./parts";
import { hasPendingWork, type StepCommitSnapshot } from "./step-commit";

// Focus the step's h2 whenever the step changes (spec §5.3), as the tour card does.
function useFocusOnChange<T extends HTMLElement>(key: string) {
  const ref = useRef<T>(null);
  useEffect(() => {
    ref.current?.focus();
  }, [key]);
  return ref;
}

/**
 * One /welcome step (spec §2.2, §5.3): the stepper, the step's h2 (PageHead owns the h1), its body
 * and the sticky footer with Skip and Continue, last in the DOM. On phones the footer docks above
 * the MobileTabBar (at its measured height, which grows in the installed app), and it hides while
 * a text field in the step has focus (B11), so the keyboard, the footer and the tab bar never cover
 * the step together. While the step holds unsaved work (`pendingWork`), Continue says it saves it
 * first ("Add 3 and continue"); `continuing` marks that save in flight.
 */
export function QuickStartFlowView({
  step,
  view,
  onSkip,
  onContinue,
  pendingWork = null,
  continuing = false,
  children,
}: {
  step: QuickStartStepId;
  view: QuickStartView;
  onSkip: () => void;
  onContinue: () => void;
  pendingWork?: StepCommitSnapshot | null;
  continuing?: boolean;
  children: ReactNode;
}) {
  const t = useTranslations("quickStart.flow");
  const tCard = useTranslations("quickStart.card");
  const { title } = useStepText();
  const eyebrowId = useId();
  const headingRef = useFocusOnChange<HTMLHeadingElement>(step);
  const [typing, setTyping] = useState(false);
  const pending = hasPendingWork(pendingWork);
  const position = stepPosition(step);
  // Position only: the h2 below carries the title, so the eyebrow never repeats or truncates it.
  const eyebrow =
    position.kind === "optional"
      ? t("optionalStep")
      : t("stepOf", { step: position.index, total: view.requiredTotal });

  const finishLater = (
    <Button
      asChild
      variant="ghost"
      size="sm"
      className="shrink-0 pointer-coarse:min-h-11"
    >
      <Link to="/dashboard">{t("finishLater")}</Link>
    </Button>
  );

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col">
      {/* Phones: one sticky eyebrow line and the segmented bar, docked under the top bar. */}
      <div className="bg-background sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-20 flex flex-col gap-2 py-2 md:hidden">
        <div className="flex items-center justify-between gap-3">
          <p id={eyebrowId} className={cn(EYEBROW, "min-w-0 truncate")}>
            {eyebrow}
          </p>
          {finishLater}
        </div>
        <QuickStartProgress
          segments={progressSegments(view.steps)}
          current={
            position.kind === "required" ? position.index - 1 : undefined
          }
          labelledBy={eyebrowId}
        />
      </div>
      {/* md and up: the checklist's markers with the step titles. Every other step is a link to
          its own URL; the current one is plain text marked aria-current="step". Not sticky. */}
      <div className="hidden items-start justify-between gap-3 md:flex">
        <ol className="flex flex-wrap gap-x-5 gap-y-2 pointer-coarse:gap-y-0">
          {view.steps.map((s) => {
            const at = stepPosition(s.id);
            const item =
              "flex items-center gap-2 rounded-md text-sm pointer-coarse:min-h-11";
            const label = (
              <>
                <StepMarker
                  state={rowState(s)}
                  number={at.kind === "required" ? at.index : undefined}
                />
                {title(s.id)}
                {at.kind === "optional" && (
                  <Badge variant="secondary">{tCard("optional")}</Badge>
                )}
              </>
            );
            return (
              <li key={s.id}>
                {s.id === step ? (
                  <span
                    aria-current="step"
                    className={cn(item, "font-semibold")}
                  >
                    {label}
                  </span>
                ) : (
                  <Link
                    to="/welcome"
                    search={{ step: s.id }}
                    className={cn(
                      item,
                      "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {label}
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
        {finishLater}
      </div>

      <div
        className="flex flex-col gap-4 py-6"
        onFocus={(e) => setTyping(isTextEntry(e.target))}
        onBlur={() => setTyping(false)}
      >
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="font-heading text-xl font-semibold focus-visible:outline-none"
        >
          {title(step)}
        </h2>
        {children}
      </div>

      <div
        className={cn(
          "bg-card sticky bottom-[var(--mobile-tab-bar-height,3.5rem)] z-20 flex flex-wrap items-center gap-3 border-t px-4 py-3 pb-[30px] md:bottom-0 md:justify-between md:pb-3",
          typing && "max-md:hidden",
        )}
      >
        {/* Why Continue is disabled, right above it: what holds it back may be far up the step. A
            live region from the start, so the reason is announced when it appears. */}
        <p
          role="status"
          className="text-muted-foreground w-full text-sm empty:hidden"
        >
          {pending ? pendingWork.reason : null}
        </p>
        <Button
          variant="ghost"
          className="pointer-coarse:min-h-11"
          disabled={continuing}
          onClick={onSkip}
        >
          {t("skip")}
        </Button>
        {/* The label may wrap on a narrow phone ("3 vastleggen en doorgaan") instead of
            pushing past the footer. */}
        <Button
          className={cn(
            PRIMARY_LOOK,
            "h-auto min-h-9 min-w-0 flex-1 py-2 whitespace-normal text-balance md:flex-none",
          )}
          disabled={continuing || (pending && !pendingWork.ready)}
          aria-busy={continuing || undefined}
          onClick={onContinue}
        >
          {continuing && (
            <Loader2 aria-hidden className="motion-safe:animate-spin" />
          )}
          {pending
            ? t(`commitAndContinue.${pendingWork.kind}`, {
                count: pendingWork.count,
              })
            : t("continue")}
        </Button>
      </div>
    </div>
  );
}

/**
 * The done panel (spec §5.5). Motion is motion-safe only, so it renders static under reduced
 * motion. While a required step is still to do it says how many are left and leads back to the
 * first one, with "Go to my shelf" as the secondary action; it only celebrates once every
 * required step is done or skipped. `tourAction` is the "Show me around" hand-off.
 */
export function QuickStartDonePanel({
  view,
  tourAction,
}: {
  view: QuickStartView;
  tourAction?: ReactNode;
}) {
  const t = useTranslations("quickStart.done");
  const headingRef = useFocusOnChange<HTMLHeadingElement>("done");
  const count = (id: QuickStartStepId) =>
    view.steps.find((s) => s.id === id)?.count ?? 0;
  const open = openRequiredSteps(view);
  const first = open[0];

  return (
    <div className="flex flex-col items-center gap-4 py-10 text-center">
      <span aria-hidden className="relative flex size-14">
        {!first && (
          <span className="bg-jigsaw-primary/30 absolute inset-0 rounded-2xl motion-safe:animate-ping motion-safe:[animation-iteration-count:1]" />
        )}
        <span className="bg-jigsaw-primary-tint text-jigsaw-primary motion-safe:animate-in motion-safe:zoom-in-90 relative flex size-14 items-center justify-center rounded-2xl">
          <Puzzle className="size-7" />
        </span>
      </span>
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="font-heading text-2xl font-semibold focus-visible:outline-none"
      >
        {first ? t("almostTitle", { count: open.length }) : t("title")}
      </h2>
      <p role="status" className="text-muted-foreground text-sm">
        {t("summary", {
          copies: count("puzzles"),
          solves: displayCount(count("solves")),
          following: displayCount(count("people")),
        })}
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-center">
        {first && (
          <Button asChild className={PRIMARY_LOOK}>
            <Link to="/welcome" search={{ step: first.id }}>
              {t("continueSetup")}
            </Link>
          </Button>
        )}
        <Button
          asChild
          variant={first ? "outline" : "default"}
          className={first ? "pointer-coarse:min-h-11" : PRIMARY_LOOK}
        >
          <Link to="/dashboard">{t("goToShelf")}</Link>
        </Button>
        {tourAction}
      </div>
    </div>
  );
}
