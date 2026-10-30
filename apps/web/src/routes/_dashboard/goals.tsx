import { useUser } from "@/compat/clerk";
import { usePageHeader } from "@/components/dashboard-layout/page-header-slot";
import {
  GoalFormDialog,
  isEditableGoal,
  type EditableGoal,
} from "@/components/goals/goal-form-dialog";
import type { GoalRow } from "@/components/goals/goal-row";
import { GOAL_GRID, GoalSections } from "@/components/goals/goal-sections";
import { EmptyState } from "@/components/library/empty-state";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { gateway } from "@/gateway";
import { goalStatus } from "@/lib/goal-form";
import { pageTitle } from "@/lib/page-title";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

export const Route = createFileRoute("/_dashboard/goals")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "goals") }],
  }),
  component: GoalsPage,
});

function GoalsPage() {
  const { user } = useUser();
  const t = useTranslations("solving.goals");
  const tCommon = useTranslations("common");

  // The create/edit dialog: `formGoal` is the goal being edited (undefined = a new goal). It is
  // only replaced when the dialog opens, so the closing animation keeps showing the same form.
  const [formOpen, setFormOpen] = useState(false);
  const [formGoal, setFormGoal] = useState<EditableGoal | undefined>();
  // Same for the delete confirm: the target outlives the closing animation.
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<EditableGoal | undefined>();

  const { data: convexUser } = useQuery(
    convexQuery(
      gateway.identity.byClerkId,
      user?.id ? { clerkId: user.id } : "skip",
    ),
  );

  const { data: goals } = useQuery(
    convexQuery(gateway.solving.myGoals, convexUser?._id ? {} : "skip"),
  );

  const setGoalArchived = useMutation({
    mutationFn: useConvexMutation(gateway.solving.setGoalArchived),
  });
  const deleteGoal = useMutation({
    mutationFn: useConvexMutation(gateway.solving.deleteGoal),
  });

  const openForm = (goal?: EditableGoal) => {
    setFormGoal(goal);
    setFormOpen(true);
  };

  const archive = async (goal: EditableGoal, archived: boolean) => {
    try {
      await setGoalArchived.mutateAsync({
        goalId: goal.aggregateId,
        archived,
      });
      toast.success(archived ? t("archiveDone") : t("restoreDone"));
    } catch (error) {
      console.error("Failed to archive goal:", error);
      toast.error(archived ? t("archiveError") : t("restoreError"));
    }
  };

  const remove = async (goal: EditableGoal) => {
    try {
      await deleteGoal.mutateAsync({ goalId: goal.aggregateId });
      toast.success(t("deleteDone"));
    } catch (error) {
      console.error("Failed to delete goal:", error);
      toast.error(t("deleteError"));
    }
  };

  const actionsFor = (goal: GoalRow) =>
    isEditableGoal(goal)
      ? {
          onEdit: () => openForm(goal),
          onArchive: () => void archive(goal, true),
          onRestore: () => void archive(goal, false),
          onDelete: () => {
            setDeleteTarget(goal);
            setDeleteOpen(true);
          },
        }
      : undefined;

  // The page title lives in the shell page head; publish the count + primary action there too so
  // the page body carries no duplicate section header. While the empty state shows, its own
  // button is the only "New goal".
  const hasGoals = goals !== undefined && goals.length > 0;
  const activeCount = (goals ?? []).filter(
    (goal) => goalStatus(goal) === "active",
  ).length;
  const headerMeta = t("activeCount", { count: activeCount });
  usePageHeader(
    () =>
      hasGoals
        ? {
            meta: headerMeta,
            actions: (
              <Button
                variant="brand"
                size="sm"
                onClick={() => openForm()}
                data-tour="goals-create"
              >
                <Plus className="h-4 w-4" />
                {t("create")}
              </Button>
            ),
          }
        : {},
    [headerMeta, hasGoals],
  );

  if (!user || convexUser === undefined || goals === undefined) {
    return (
      <div className="@container/goals flex w-full flex-col gap-[26px]">
        <Skeleton className="h-10 w-full" />
        <div className={GOAL_GRID}>
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-[26px]">
      <GoalFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        goal={formGoal}
      />

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("deleteTitle", { title: deleteTarget?.title ?? "" })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t("deleteBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              onClick={() => {
                if (deleteTarget) void remove(deleteTarget);
              }}
            >
              {t("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {goals.length === 0 ? (
        <EmptyState
          title={t("empty")}
          sub={t("emptyHint")}
          action={
            <Button
              variant="brand"
              onClick={() => openForm()}
              data-tour="goals-create"
            >
              <Plus className="h-4 w-4" />
              {t("create")}
            </Button>
          }
        />
      ) : (
        <GoalSections goals={goals} actionsFor={actionsFor} />
      )}
    </div>
  );
}
