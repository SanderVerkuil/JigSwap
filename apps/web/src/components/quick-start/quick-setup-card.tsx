"use client";

import { SectionHead } from "@/components/dashboard-home/section-head";
import { SHELF_HEADING_ID } from "@/components/dashboard-home/shelf-section";
import { useCurrentMember } from "@/components/dashboard-home/use-current-member";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { gateway } from "@/gateway";
import { cn } from "@/lib/utils";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import type { QuickStartView } from "@jigswap/contracts";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronRight, ListChecks, X } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";
import { cardMode, progressSegments, rowState } from "./logic";
import { QuickStartProgress, StepMarker, useStepText } from "./parts";
import {
  markQuickStartHidden,
  useMarkQuickStartUsed,
  useQuickStartSession,
} from "./session";

// The dashboard checklist (spec §2.3, §5.2), between BriefingHero and ShelfSection. Visibility
// comes from the server (getQuickStart.cardVisible); the one-row "all set up" state is per
// session. Hiding stores the dismissal on the server and moves focus to the Shelf heading.
export function QuickSetupCard() {
  const t = useTranslations("quickStart.card");
  const { member } = useCurrentMember();
  const { data: view } = useQuery(
    convexQuery(gateway.onboarding.quickStart, member ? {} : "skip"),
  );
  const session = useQuickStartSession();
  const [hidden, setHidden] = useState(false);
  const record = useConvexMutation(gateway.onboarding.recordQuickStart);

  const mode = cardMode({
    view,
    usedThisSession: session === "1",
    hiddenThisSession: hidden || session === "hidden",
  });
  useMarkQuickStartUsed(mode === "active");

  if (mode === "hidden" || !view) return null;

  const hide = () => {
    // Focus first: the button that has it is about to unmount.
    document.getElementById(SHELF_HEADING_ID)?.focus();
    markQuickStartHidden();
    setHidden(true);
    toast(t("hiddenToast"));
    record({ kind: "dismissCard" }).catch((error: unknown) =>
      console.error("Failed to hide quick setup:", error),
    );
  };

  return <QuickSetupCardView view={view} mode={mode} onHide={hide} />;
}

export function QuickSetupCardView({
  view,
  mode,
  onHide,
}: {
  view: QuickStartView;
  mode: "active" | "allDone";
  onHide: () => void;
}) {
  const t = useTranslations("quickStart.card");
  const { title, subLine } = useStepText();
  const headingId = useId();

  if (mode === "allDone") {
    return (
      <section aria-label={t("title")}>
        <div className="flex min-h-11 items-center gap-3.5">
          <StepMarker state="done" number={0} />
          <p className="min-w-0 flex-1 text-sm font-semibold">{t("allDone")}</p>
          <Button
            variant="ghost"
            size="sm"
            className="pointer-coarse:min-h-11"
            aria-label={t("hide")}
            onClick={onHide}
          >
            {t("hideDone")}
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby={headingId}>
      <SectionHead
        title={t("title")}
        icon={ListChecks}
        headingProps={{ id: headingId }}
        meta={t("progress", {
          done: view.requiredDone,
          total: view.requiredTotal,
        })}
        action={
          <Button
            variant="ghost"
            size="icon"
            className="size-9 pointer-coarse:size-11"
            aria-label={t("hide")}
            onClick={onHide}
          >
            <X aria-hidden />
          </Button>
        }
        className="mb-4"
      />
      <QuickStartProgress
        segments={progressSegments(view.steps)}
        labelledBy={headingId}
      />
      <ol className="mt-2">
        {view.steps.map((step, i) => {
          const state = rowState(step);
          const sub = subLine(step);
          return (
            <li key={step.id} className="border-t first:border-t-0">
              <Link
                to="/welcome"
                search={{ step: step.id }}
                className="group flex min-h-11 items-center gap-3.5 py-3"
              >
                <StepMarker
                  state={state}
                  number={i + 1}
                  pending={step.pendingInvite && state === "todo"}
                />
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "flex flex-wrap items-center gap-2 text-sm font-semibold",
                      state === "done" && "text-muted-foreground",
                    )}
                  >
                    {title(step.id)}
                    {step.optional && (
                      <Badge variant="secondary">{t("optional")}</Badge>
                    )}
                  </span>
                  <span className="sr-only">, {t(`state.${state}`)}</span>
                  {sub && (
                    <span className="text-muted-foreground mt-px block text-xs">
                      <span className="sr-only">, </span>
                      {sub}
                    </span>
                  )}
                </span>
                <ChevronRight
                  aria-hidden
                  className="text-muted-foreground group-hover:text-foreground size-4 shrink-0"
                />
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
