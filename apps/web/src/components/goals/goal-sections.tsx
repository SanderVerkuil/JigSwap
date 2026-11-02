import { SectionHead } from "@/components/dashboard-home/section-head";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { goalStatus, type GoalStatus } from "@/lib/goal-form";
import { cn } from "@/lib/utils";
import { ChevronDown, History, Target, Trophy } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "use-intl";
import type { GoalRow } from "./goal-row";
import { GoalTile, type GoalTileActions } from "./goal-tile";

// Columns follow the width the page body actually has (a container query), not the viewport: next
// to the sidebar on a tablet two columns would squeeze each title to a few characters.
export const GOAL_GRID =
  "grid gap-x-10 gap-y-8 @2xl/goals:grid-cols-2 @6xl/goals:grid-cols-3";

// The goals page body for a member with at least one goal: Active, Achieved, and a collapsible
// "Past goals" (ended or archived). A section with no goals is not shown. Past goals stay
// collapsed unless they are all the member has, or the member opened them.
export function GoalSections({
  goals,
  actionsFor,
  now = new Date(),
}: {
  goals: readonly GoalRow[];
  actionsFor: (goal: GoalRow) => GoalTileActions | undefined;
  now?: Date;
}) {
  const t = useTranslations("solving.goals");

  const withStatus = goals.map((goal) => ({
    goal,
    status: goalStatus(goal, now),
  }));
  const inStatus = (...statuses: GoalStatus[]) =>
    withStatus.filter((entry) => statuses.includes(entry.status));
  const active = inStatus("active");
  const achieved = inStatus("achieved");
  const past = inStatus("ended", "archived");

  // The member's own toggle wins; until they use it, this follows the goals, so archiving the last
  // live goal doesn't leave nothing but a collapsed header.
  const [pastToggled, setPastToggled] = useState<boolean | undefined>();
  const pastOpen =
    pastToggled ?? (active.length === 0 && achieved.length === 0);

  const grid = (entries: typeof withStatus) => (
    <div className={GOAL_GRID}>
      {entries.map(({ goal, status }) => (
        <GoalTile
          key={goal._id}
          goal={goal}
          status={status}
          actions={actionsFor(goal)}
        />
      ))}
    </div>
  );

  return (
    <div className="@container/goals flex flex-col gap-[26px]">
      {active.length > 0 && (
        <section>
          <SectionHead
            title={t("active")}
            icon={Target}
            meta={t("activeCount", { count: active.length })}
          />
          {grid(active)}
        </section>
      )}

      {achieved.length > 0 && (
        <section>
          <SectionHead title={t("achieved")} icon={Trophy} />
          {grid(achieved)}
        </section>
      )}

      {past.length > 0 && (
        <Collapsible asChild open={pastOpen} onOpenChange={setPastToggled}>
          <section>
            <SectionHead
              title={t("past")}
              icon={History}
              meta={t("goalCount", { count: past.length })}
              action={
                <CollapsibleTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="-my-1 size-9 pointer-coarse:size-11"
                    aria-label={pastOpen ? t("hidePast") : t("showPast")}
                  >
                    <ChevronDown
                      aria-hidden
                      className={cn(
                        "size-4 transition-transform",
                        pastOpen && "rotate-180",
                      )}
                    />
                  </Button>
                </CollapsibleTrigger>
              }
            />
            <CollapsibleContent>{grid(past)}</CollapsibleContent>
          </section>
        </Collapsible>
      )}
    </div>
  );
}
