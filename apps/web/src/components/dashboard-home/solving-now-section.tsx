"use client";

import { Image } from "@/compat/image";
import { Link } from "@/compat/link";
import { SectionHead } from "@/components/dashboard-home/section-head";
import { useCurrentMember } from "@/components/dashboard-home/use-current-member";
import { FinishSolveDialog } from "@/components/solving/finish-solve-dialog";
import { Button } from "@/components/ui/button";
import { gateway } from "@/gateway";
import { cn } from "@/lib/utils";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { CircleCheck, Puzzle } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "use-intl";

// The dashboard's in-progress rail: what the member is solving right now, with a one-click finish.
export function SolvingNowSection() {
  const t = useTranslations("dashboard.solvingNow");
  const { member } = useCurrentMember();
  const { data: solves } = useQuery(
    convexQuery(gateway.solving.myInProgress, member?._id ? {} : "skip"),
  );
  const [finishTarget, setFinishTarget] = useState<{
    completionId: string;
    startDate: number;
  } | null>(null);
  // Calling Date.now() during render is an impure-render violation; capture it once at mount
  // (matches the codebase's existing `useState(() => Date.now())` idiom).
  const [now] = useState(() => Date.now());

  if (!member || solves === undefined) return null;

  // Clamped relative copy: future-dated starts read "starts in N days", never "-N days ago".
  const startedLabel = (startDate: number): string => {
    const days = Math.floor((now - startDate) / 86400000);
    if (days < 0) return t("startsInDays", { days: -days });
    if (days === 0) return t("startedToday");
    return t("startedDaysAgo", { days });
  };

  return (
    <section>
      <SectionHead title={t("title")} icon={Puzzle} />
      {solves.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {t("empty")}{" "}
          <Link href="/my-puzzles" className="underline underline-offset-2">
            {t("emptyCta")}
          </Link>
        </p>
      ) : (
        <div className="flex flex-col">
          {solves.map((solve, index) => (
            <div
              key={solve.completionId}
              className={cn(
                "flex items-center gap-3.5 py-3",
                index < solves.length - 1 && "border-b",
              )}
            >
              {solve.thumbnailUrl ? (
                <Image
                  src={solve.thumbnailUrl}
                  alt=""
                  width={44}
                  height={44}
                  className="h-11 w-11 shrink-0 rounded-md object-cover"
                />
              ) : (
                <span className="bg-muted flex h-11 w-11 shrink-0 items-center justify-center rounded-md">
                  <Puzzle className="text-muted-foreground h-5 w-5" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">
                  {solve.title ?? t("untitled")}
                </p>
                <p className="text-muted-foreground text-xs">
                  {solve.pieceCount !== undefined &&
                    `${t("pieces", { count: solve.pieceCount })} · `}
                  {startedLabel(solve.startDate)}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setFinishTarget({
                    completionId: solve.completionId,
                    startDate: solve.startDate,
                  })
                }
              >
                <CircleCheck className="h-4 w-4" />
                {t("finish")}
              </Button>
            </div>
          ))}
        </div>
      )}

      {finishTarget && (
        <FinishSolveDialog
          open
          onOpenChange={(open) => !open && setFinishTarget(null)}
          completionId={finishTarget.completionId}
          minEndDate={finishTarget.startDate}
        />
      )}
    </section>
  );
}
