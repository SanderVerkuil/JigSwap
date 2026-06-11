import { createFileRoute } from "@tanstack/react-router";

import { useUser } from "@/compat/clerk";
import { EditCompletionDialog } from "@/components/solving/edit-completion-dialog";
import { FinishSolveDialog } from "@/components/solving/finish-solve-dialog";
import { ReviewPuzzleDialog } from "@/components/solving/review-puzzle-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageLoading } from "@/components/ui/loading";
import { StarRating } from "@/components/ui/star-rating";
import { gateway, Id } from "@/gateway";
import { useQuery } from "convex/react";
import { CircleCheck, Clock, Pencil, Star } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslations } from "use-intl";

type DialogState =
  | { kind: "finish"; completionId: string }
  | {
      kind: "edit";
      completionId: string;
      startDate: number;
      endDate?: number;
      timeMinutes?: number;
      notes?: string;
    }
  | {
      kind: "review";
      completionId: string;
      rating?: number;
      text?: string;
    }
  | null;

export const Route = createFileRoute("/_dashboard/completions")({
  component: CompletionsPage,
});

function CompletionsPage() {
  const { user } = useUser();
  const t = useTranslations("solving.completions");
  const tCommon = useTranslations("common");
  const [dialog, setDialog] = useState<DialogState>(null);

  const convexUser = useQuery(
    gateway.identity.byClerkId,
    user?.id ? { clerkId: user.id } : "skip",
  );

  const completions = useQuery(
    gateway.solving.myCompletions,
    convexUser?._id ? {} : "skip",
  );

  // The completion rows reference an owned copy by FK id only; join the member's library to
  // resolve a human title. Built once per library load.
  const ownedPuzzles = useQuery(
    gateway.library.ownedByOwner,
    convexUser?._id
      ? { ownerId: convexUser._id as Id<"users">, includeUnavailable: true }
      : "skip",
  );

  const titleByCopyId = useMemo(() => {
    const map = new Map<string, string>();
    for (const copy of ownedPuzzles ?? []) {
      if (copy.puzzle?.title) map.set(copy._id, copy.puzzle.title);
    }
    return map;
  }, [ownedPuzzles]);

  if (!user || convexUser === undefined || completions === undefined) {
    return <PageLoading message={tCommon("loading")} />;
  }

  const formatTime = (minutes?: number): string => {
    if (minutes === undefined) return t("noTime");
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h > 0
      ? t("time", { hours: h, minutes: m })
      : t("timeMinutes", { minutes: m });
  };

  const formatDate = (ms: number) => new Date(ms).toLocaleDateString();

  return (
    <div className="container mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </div>

      {completions.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <CircleCheck className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="mb-2 text-lg font-medium">{t("empty")}</h3>
            <p className="text-sm text-muted-foreground">{t("emptyHint")}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {completions.map((completion) => {
            const title =
              (completion.ownedPuzzleId &&
                titleByCopyId.get(
                  completion.ownedPuzzleId as Id<"ownedPuzzles">,
                )) ||
              t("title");
            const done = completion.isCompleted;
            return (
              <Card key={completion._id}>
                <CardContent className="p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold">{title}</h3>
                        <Badge variant={done ? "default" : "secondary"}>
                          {done ? t("completed") : t("inProgress")}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                        <span>
                          {t("started", {
                            date: formatDate(completion.startDate),
                          })}
                        </span>
                        {completion.endDate !== undefined && (
                          <span>
                            {t("finished", {
                              date: formatDate(completion.endDate),
                            })}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5" />
                          {formatTime(completion.completionTimeMinutes)}
                        </span>
                      </div>
                      {completion.notes && (
                        <p className="text-sm text-muted-foreground">
                          {completion.notes}
                        </p>
                      )}
                      {completion.rating !== undefined && (
                        <div className="flex items-center gap-2 pt-1">
                          <StarRating value={completion.rating} size="sm" />
                          {completion.review && (
                            <span className="text-sm text-muted-foreground">
                              {completion.review}
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {!done && completion.aggregateId && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setDialog({
                              kind: "finish",
                              completionId: completion.aggregateId!,
                            })
                          }
                        >
                          <CircleCheck className="mr-2 h-4 w-4" />
                          {t("finish")}
                        </Button>
                      )}
                      {completion.aggregateId && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setDialog({
                              kind: "review",
                              completionId: completion.aggregateId!,
                              rating: completion.rating,
                              text: completion.review,
                            })
                          }
                        >
                          <Star className="mr-2 h-4 w-4" />
                          {completion.rating !== undefined
                            ? t("editReview")
                            : t("addReview")}
                        </Button>
                      )}
                      {completion.aggregateId && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setDialog({
                              kind: "edit",
                              completionId: completion.aggregateId!,
                              startDate: completion.startDate,
                              endDate: completion.endDate,
                              timeMinutes: completion.completionTimeMinutes,
                              notes: completion.notes,
                            })
                          }
                        >
                          <Pencil className="mr-2 h-4 w-4" />
                          {t("edit")}
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {dialog?.kind === "finish" && (
        <FinishSolveDialog
          open
          onOpenChange={(open) => !open && setDialog(null)}
          completionId={dialog.completionId}
        />
      )}
      {dialog?.kind === "review" && (
        <ReviewPuzzleDialog
          open
          onOpenChange={(open) => !open && setDialog(null)}
          completionId={dialog.completionId}
          initialRating={dialog.rating}
          initialText={dialog.text}
        />
      )}
      {dialog?.kind === "edit" && (
        <EditCompletionDialog
          open
          onOpenChange={(open) => !open && setDialog(null)}
          completionId={dialog.completionId}
          initialStartDate={dialog.startDate}
          initialEndDate={dialog.endDate}
          initialTimeMinutes={dialog.timeMinutes}
          initialNotes={dialog.notes}
        />
      )}
    </div>
  );
}
