import { pageTitle } from "@/lib/page-title";
import { createFileRoute } from "@tanstack/react-router";

import { useUser } from "@/compat/clerk";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageLoading } from "@/components/ui/loading";
import { Textarea } from "@/components/ui/textarea";
import { gateway } from "@/gateway";
import { useMutation, useQuery } from "convex/react";
import { Plus, Target, Trophy } from "lucide-react";
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

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [target, setTarget] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const convexUser = useQuery(
    gateway.identity.byClerkId,
    user?.id ? { clerkId: user.id } : "skip",
  );

  const goals = useQuery(
    gateway.solving.myGoals,
    convexUser?._id ? {} : "skip",
  );

  const createGoal = useMutation(gateway.solving.createGoal);

  const reset = () => {
    setTitle("");
    setDescription("");
    setTarget("");
    setTargetDate("");
  };

  const handleCreate = async () => {
    const targetCompletions = Number(target);
    if (
      !title.trim() ||
      !Number.isFinite(targetCompletions) ||
      targetCompletions < 1
    ) {
      return;
    }
    const dueMs = targetDate ? new Date(targetDate).getTime() : undefined;

    setSubmitting(true);
    try {
      await createGoal({
        title: title.trim(),
        description: description.trim() || undefined,
        targetCompletions,
        targetDate:
          dueMs !== undefined && !Number.isNaN(dueMs) ? dueMs : undefined,
      });
      toast.success(t("created"));
      reset();
      setOpen(false);
    } catch (error) {
      console.error("Failed to create goal:", error);
      toast.error(t("createError"));
    } finally {
      setSubmitting(false);
    }
  };

  if (!user || convexUser === undefined || goals === undefined) {
    return <PageLoading message={tCommon("loading")} />;
  }

  return (
    <div className="container mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t("title")}</h1>
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </div>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              {t("create")}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("createTitle")}</DialogTitle>
              <DialogDescription>{t("createDescription")}</DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="goal-title">{t("goalTitle")}</Label>
                <Input
                  id="goal-title"
                  value={title}
                  placeholder={t("goalTitlePlaceholder")}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="goal-description">{t("goalDescription")}</Label>
                <Textarea
                  id="goal-description"
                  value={description}
                  placeholder={t("goalDescriptionPlaceholder")}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="goal-target">{t("targetCompletions")}</Label>
                  <Input
                    id="goal-target"
                    type="number"
                    min={1}
                    inputMode="numeric"
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="goal-date">{t("targetDate")}</Label>
                  <Input
                    id="goal-date"
                    type="date"
                    value={targetDate}
                    onChange={(e) => setTargetDate(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button
                onClick={handleCreate}
                disabled={submitting || !title.trim() || !target}
              >
                {t("submit")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {goals.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <Target className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="mb-2 text-lg font-medium">{t("empty")}</h3>
            <p className="text-sm text-muted-foreground">{t("emptyHint")}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {goals.map((goal) => {
            // Progress is derived from the server-maintained counts; never recomputed beyond a
            // clamped percentage for the bar width.
            const pct =
              goal.targetCompletions > 0
                ? Math.min(
                    100,
                    Math.round(
                      (goal.currentCompletions / goal.targetCompletions) * 100,
                    ),
                  )
                : 0;
            return (
              <Card key={goal._id}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base">{goal.title}</CardTitle>
                    {goal.isAchieved && (
                      <Badge className="shrink-0">
                        <Trophy className="mr-1 h-3 w-3" />
                        {t("achieved")}
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {goal.description && (
                    <p className="text-sm text-muted-foreground">
                      {goal.description}
                    </p>
                  )}
                  <div className="space-y-1">
                    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {t("progress", {
                        current: goal.currentCompletions,
                        target: goal.targetCompletions,
                      })}
                    </p>
                  </div>
                  {goal.targetDate !== undefined && (
                    <p className="text-xs text-muted-foreground">
                      {t("dueBy", {
                        date: new Date(goal.targetDate).toLocaleDateString(),
                      })}
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
