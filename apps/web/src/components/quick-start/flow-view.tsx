"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { QuickStartStepId, QuickStartView } from "@jigswap/contracts";
import { Link } from "@tanstack/react-router";
import { Puzzle } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "use-intl";
import {
  displayCount,
  isTextEntry,
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
 * the MobileTabBar, and it hides while a text field in the step has focus (B11), so the keyboard,
 * the footer and the tab bar never cover the step together.
 */
export function QuickStartFlowView({
  step,
  view,
  onSkip,
  onContinue,
  children,
}: {
  step: QuickStartStepId;
  view: QuickStartView;
  onSkip: () => void;
  onContinue: () => void;
  children: ReactNode;
}) {
  const t = useTranslations("quickStart.flow");
  const { title } = useStepText();
  const eyebrowId = useId();
  const headingRef = useFocusOnChange<HTMLHeadingElement>(step);
  const [typing, setTyping] = useState(false);
  const position = stepPosition(step);
  const eyebrow =
    position.kind === "optional"
      ? `${t("optionalStep")} · ${title(step)}`
      : `${t("stepOf", { step: position.index, total: view.requiredTotal })} · ${title(step)}`;

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
    <div className="flex flex-col">
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
          labelledBy={eyebrowId}
        />
      </div>
      {/* md and up: the checklist's markers with the step titles. Not sticky. */}
      <div className="hidden items-start justify-between gap-3 md:flex">
        <ol className="flex flex-wrap gap-x-5 gap-y-2">
          {view.steps.map((s, i) => (
            <li
              key={s.id}
              aria-current={s.id === step ? "step" : undefined}
              className={cn(
                "flex items-center gap-2 text-sm",
                s.id === step ? "font-semibold" : "text-muted-foreground",
              )}
            >
              <StepMarker state={rowState(s)} number={i + 1} />
              {title(s.id)}
            </li>
          ))}
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
          "bg-card sticky bottom-14 z-20 flex items-center gap-3 border-t px-4 py-3 pb-[30px] md:bottom-0 md:justify-between md:pb-3",
          typing && "max-md:hidden",
        )}
      >
        <Button
          variant="ghost"
          className="pointer-coarse:min-h-11"
          onClick={onSkip}
        >
          {t("skip")}
        </Button>
        <Button
          className={cn(PRIMARY_LOOK, "flex-1 md:flex-none")}
          onClick={onContinue}
        >
          {t("continue")}
        </Button>
      </div>
    </div>
  );
}

/**
 * The done panel (spec §5.5). Motion is motion-safe only, so it renders static under reduced
 * motion. `tourAction` is the seam for Q8's "Show me around" hand-off; until then only "Go to
 * my shelf" shows.
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

  return (
    <div className="flex flex-col items-center gap-4 py-10 text-center">
      <span aria-hidden className="relative flex size-14">
        <span className="bg-jigsaw-primary/30 absolute inset-0 rounded-2xl motion-safe:animate-ping motion-safe:[animation-iteration-count:1]" />
        <span className="bg-jigsaw-primary-tint text-jigsaw-primary motion-safe:animate-in motion-safe:zoom-in-90 relative flex size-14 items-center justify-center rounded-2xl">
          <Puzzle className="size-7" />
        </span>
      </span>
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="font-heading text-2xl font-semibold focus-visible:outline-none"
      >
        {t("title")}
      </h2>
      <p role="status" className="text-muted-foreground text-sm">
        {t("summary", {
          copies: count("puzzles"),
          solves: displayCount(count("solves")),
          following: displayCount(count("people")),
        })}
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button asChild className={PRIMARY_LOOK}>
          <Link to="/dashboard">{t("goToShelf")}</Link>
        </Button>
        {tourAction}
      </div>
    </div>
  );
}
