import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatDateOnly } from "@/lib/date-input";
import type { GoalStatus } from "@/lib/goal-form";
import { cn } from "@/lib/utils";
import {
  Archive,
  ArchiveRestore,
  Flag,
  MoreHorizontal,
  Pencil,
  Target,
  Trash2,
  Trophy,
  type LucideIcon,
} from "lucide-react";
import { useRef } from "react";
import { useTranslations } from "use-intl";
import type { GoalRow } from "./goal-row";

// What the member can do with a goal from its tile. Absent for a goal the goal mutations can't
// address (a legacy row without an aggregateId), which then shows no menu. The actions that open a
// dialog get the tile's menu button, for focus to return to when it closes.
export interface GoalTileActions {
  onEdit: (opener: HTMLElement | null) => void;
  onArchive: () => void;
  onRestore: () => void;
  onDelete: (opener: HTMLElement | null) => void;
}

// Past goals (ended or archived) are drawn in neutral tones so the live ones stand out.
const STATUS_LOOK: Record<
  GoalStatus,
  { icon: LucideIcon; chip: string; bar: string }
> = {
  active: {
    icon: Target,
    chip: "bg-jigsaw-primary/10 text-jigsaw-primary",
    bar: "bg-jigsaw-primary",
  },
  achieved: {
    icon: Trophy,
    chip: "bg-jigsaw-secondary/15 text-jigsaw-secondary-text",
    bar: "bg-jigsaw-secondary",
  },
  ended: {
    icon: Flag,
    chip: "bg-muted text-muted-foreground",
    bar: "bg-muted-foreground/50",
  },
  archived: {
    icon: Archive,
    chip: "bg-muted text-muted-foreground",
    bar: "bg-muted-foreground/50",
  },
};

export function GoalTile({
  goal,
  status,
  actions,
}: {
  goal: GoalRow;
  status: GoalStatus;
  actions?: GoalTileActions;
}) {
  const t = useTranslations("solving.goals");
  const look = STATUS_LOOK[status];
  const Icon = look.icon;
  const menuTriggerRef = useRef<HTMLButtonElement>(null);

  // Progress is derived from the server-maintained counts; never recomputed beyond a
  // clamped percentage for the bar width.
  const pct =
    goal.targetCompletions > 0
      ? Math.min(
          100,
          Math.round((goal.currentCompletions / goal.targetCompletions) * 100),
        )
      : 0;

  // The period the goal counts solves in. Without a start date it counts from the (UTC) day it
  // was created, like the server does; dates are calendar dates, shown in UTC.
  const from = formatDateOnly(goal.startDate ?? goal.createdAt);
  const period =
    goal.targetDate !== undefined
      ? t("periodRange", { from, to: formatDateOnly(goal.targetDate) })
      : t("periodFrom", { from });

  const progressCount = t("progressShort", {
    current: goal.currentCompletions,
    target: goal.targetCompletions,
  });

  return (
    <div className="@container/goal">
      <div className="mb-2.5 flex items-center gap-3">
        <span
          className={cn(
            "inline-flex size-9 shrink-0 items-center justify-center rounded-full",
            look.chip,
          )}
        >
          <Icon aria-hidden className="size-[17px]" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 text-base font-semibold break-words">
              {goal.title}
            </span>
            {status === "achieved" && (
              <Badge className="shrink-0">
                <Trophy aria-hidden className="mr-1 h-3 w-3" />
                {t("achieved")}
              </Badge>
            )}
            {status === "ended" && (
              <Badge variant="outline" className="text-muted-foreground">
                {t("ended")}
              </Badge>
            )}
            {status === "archived" && (
              <Badge variant="outline" className="text-muted-foreground">
                {t("archived")}
              </Badge>
            )}
          </div>
          <div className="text-muted-foreground mt-px text-xs">{period}</div>
          {/* In a narrow tile the count sits under the title, so the title keeps the width. */}
          <div className="text-muted-foreground font-mono text-xs @sm/goal:hidden">
            {progressCount}
          </div>
        </div>
        <div className="text-right">
          <div className="font-heading text-xl leading-none font-bold">
            {pct}%
          </div>
          <div className="text-muted-foreground hidden font-mono text-xs @sm/goal:block">
            {progressCount}
          </div>
        </div>
        {actions && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                ref={menuTriggerRef}
                variant="ghost"
                size="icon"
                className="-mr-2 size-9 shrink-0 pointer-coarse:size-11"
                aria-label={t("menuLabel", { title: goal.title })}
              >
                <MoreHorizontal aria-hidden className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() => actions.onEdit(menuTriggerRef.current)}
              >
                <Pencil aria-hidden />
                {t("edit")}
              </DropdownMenuItem>
              {goal.isActive ? (
                <DropdownMenuItem onSelect={actions.onArchive}>
                  <Archive aria-hidden />
                  {t("archive")}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={actions.onRestore}>
                  <ArchiveRestore aria-hidden />
                  {t("restore")}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => actions.onDelete(menuTriggerRef.current)}
              >
                <Trash2 aria-hidden />
                {t("delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <div className="bg-muted h-2.5 w-full overflow-hidden rounded-full">
        <div
          className={cn("h-full rounded-full transition-all", look.bar)}
          style={{ width: `${pct}%` }}
        />
      </div>
      {goal.description && (
        <p className="text-muted-foreground mt-1.5 text-xs">
          {goal.description}
        </p>
      )}
    </div>
  );
}
