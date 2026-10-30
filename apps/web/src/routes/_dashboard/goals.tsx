import { useUser } from "@/compat/clerk";
import { SectionHead } from "@/components/dashboard-home/section-head";
import { usePageHeader } from "@/components/dashboard-layout/page-header-slot";
import { GoalFormDialog } from "@/components/goals/goal-form-dialog";
import type { GoalRow } from "@/components/goals/goal-row";
import { EmptyState } from "@/components/library/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { gateway } from "@/gateway";
import { pageTitle } from "@/lib/page-title";
import { cn } from "@/lib/utils";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, Target, Trophy } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "use-intl";

const GOAL_GRID = "grid gap-x-10 gap-y-8 md:grid-cols-2 2xl:grid-cols-3";

export const Route = createFileRoute("/_dashboard/goals")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "goals") }],
  }),
  component: GoalsPage,
});

function GoalsPage() {
  const { user } = useUser();
  const t = useTranslations("solving.goals");

  const [open, setOpen] = useState(false);

  const { data: convexUser } = useQuery(
    convexQuery(
      gateway.identity.byClerkId,
      user?.id ? { clerkId: user.id } : "skip",
    ),
  );

  const { data: goals } = useQuery(
    convexQuery(gateway.solving.myGoals, convexUser?._id ? {} : "skip"),
  );

  // The page title lives in the shell page head; publish the count + primary
  // action there too so the page body carries no duplicate section header.
  const activeCount = (goals ?? []).filter((goal) => !goal.isAchieved).length;
  const headerMeta = t("activeCount", { count: activeCount });
  usePageHeader(
    () => ({
      meta: headerMeta,
      actions: (
        <Button
          variant="brand"
          size="sm"
          onClick={() => setOpen(true)}
          data-tour="goals-create"
        >
          <Plus className="h-4 w-4" />
          {t("create")}
        </Button>
      ),
    }),
    [headerMeta],
  );

  if (!user || convexUser === undefined || goals === undefined) {
    return (
      <div className="flex w-full flex-col gap-[26px]">
        <Skeleton className="h-10 w-full" />
        <div className={GOAL_GRID}>
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      </div>
    );
  }

  const active = goals.filter((goal) => !goal.isAchieved);
  const achieved = goals.filter((goal) => goal.isAchieved);

  return (
    <div className="flex w-full flex-col gap-[26px]">
      <GoalFormDialog open={open} onOpenChange={setOpen} />

      {goals.length === 0 ? (
        <EmptyState
          title={t("empty")}
          sub={t("emptyHint")}
          action={
            <Button variant="brand" onClick={() => setOpen(true)}>
              <Plus className="h-4 w-4" />
              {t("create")}
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-[26px]">
          <section>
            <SectionHead
              title={t("active")}
              icon={Target}
              meta={t("activeCount", { count: active.length })}
            />
            <div className={GOAL_GRID}>
              {active.map((goal) => (
                <GoalTile key={goal._id} goal={goal} />
              ))}
            </div>
          </section>

          {achieved.length > 0 && (
            <section>
              <SectionHead title={t("achieved")} icon={Trophy} />
              <div className={GOAL_GRID}>
                {achieved.map((goal) => (
                  <GoalTile key={goal._id} goal={goal} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function GoalTile({ goal }: { goal: GoalRow }) {
  const t = useTranslations("solving.goals");

  // Progress is derived from the server-maintained counts; never recomputed beyond a
  // clamped percentage for the bar width.
  const pct =
    goal.targetCompletions > 0
      ? Math.min(
          100,
          Math.round((goal.currentCompletions / goal.targetCompletions) * 100),
        )
      : 0;
  const GoalIcon = goal.isAchieved ? Trophy : Target;

  return (
    <div>
      <div className="mb-2.5 flex items-center gap-3">
        <span
          className={cn(
            "inline-flex size-9 shrink-0 items-center justify-center rounded-full",
            goal.isAchieved
              ? "bg-jigsaw-secondary/15 text-jigsaw-secondary"
              : "bg-jigsaw-primary/10 text-jigsaw-primary",
          )}
        >
          <GoalIcon className="size-[17px]" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold">{goal.title}</span>
            {goal.isAchieved && (
              <Badge className="shrink-0">
                <Trophy className="mr-1 h-3 w-3" />
                {t("achieved")}
              </Badge>
            )}
          </div>
          <div className="text-muted-foreground mt-px text-xs">
            {goal.targetDate !== undefined
              ? t("dueBy", {
                  date: new Date(goal.targetDate).toLocaleDateString(),
                })
              : goal.description}
          </div>
        </div>
        <div className="text-right">
          <div className="font-heading text-xl leading-none font-bold">
            {pct}%
          </div>
          <div className="text-muted-foreground font-mono text-xs">
            {t("progressShort", {
              current: goal.currentCompletions,
              target: goal.targetCompletions,
            })}
          </div>
        </div>
      </div>
      <div className="bg-muted h-2.5 w-full overflow-hidden rounded-full">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            goal.isAchieved ? "bg-jigsaw-secondary" : "bg-jigsaw-primary",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      {goal.targetDate !== undefined && goal.description && (
        <p className="text-muted-foreground mt-1.5 text-xs">
          {goal.description}
        </p>
      )}
    </div>
  );
}
