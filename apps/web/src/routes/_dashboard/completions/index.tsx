import { pageTitle } from "@/lib/page-title";
import { createFileRoute } from "@tanstack/react-router";

import { useUser } from "@/compat/clerk";
import { Link } from "@/compat/link";
import { usePageHeaderActions } from "@/components/dashboard-layout/page-header-slot";
import { CoverChip } from "@/components/library/cover-chip";
import { EmptyState } from "@/components/library/empty-state";
import { chipColor } from "@/components/library/palette";
import { StatRow } from "@/components/library/stat-row";
import { EditCompletionDialog } from "@/components/solving/edit-completion-dialog";
import { FinishSolveDialog } from "@/components/solving/finish-solve-dialog";
import { ReviewPuzzleDialog } from "@/components/solving/review-puzzle-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StarRating } from "@/components/ui/star-rating";
import { gateway, Id } from "@/gateway";
import { cn } from "@/lib/utils";
import { useQuery } from "convex/react";
import { CircleCheck, Clock, Pencil, Plus, Star } from "lucide-react";
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

export const Route = createFileRoute("/_dashboard/completions/")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "completions") }],
  }),
  component: CompletionsPage,
});

function CompletionsSkeleton() {
  return (
    <div className="flex flex-col gap-[26px]">
      <div className="grid grid-cols-2 gap-6 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16" />
        ))}
      </div>
      <Skeleton className="h-10 w-full" />
      <div className="flex flex-col gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-14" />
        ))}
      </div>
    </div>
  );
}

function CompletionsPage() {
  const { user } = useUser();
  const t = useTranslations("solving.completions");
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
  // resolve a human title and the piece count. Built once per library load.
  const ownedPuzzles = useQuery(
    gateway.library.ownedByOwner,
    convexUser?._id
      ? { ownerId: convexUser._id as Id<"users">, includeUnavailable: true }
      : "skip",
  );

  const infoByCopyId = useMemo(() => {
    const map = new Map<string, { title: string; pieceCount?: number }>();
    for (const copy of ownedPuzzles ?? []) {
      if (copy.puzzle?.title) {
        map.set(copy._id, {
          title: copy.puzzle.title,
          pieceCount: copy.puzzle.pieceCount,
        });
      }
    }
    return map;
  }, [ownedPuzzles]);

  // The page title lives in the shell page head; publish the log meta + the Log
  // Completion action there so the body carries no duplicate section header.
  usePageHeaderActions(
    () => (
      <>
        <span className="text-muted-foreground hidden text-sm sm:inline">
          {t("mostRecent")}
        </span>
        <Button variant="brand" size="sm" asChild>
          <Link href="/completions/new">
            <Plus className="h-4 w-4" />
            {t("logAction")}
          </Link>
        </Button>
      </>
    ),
    [t],
  );

  if (!user || convexUser === undefined || completions === undefined) {
    return <CompletionsSkeleton />;
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

  // Top stats, computed from the real solve log: total finished, pieces placed
  // across those (via the library join) and finishes within the current year.
  const finished = completions.filter((completion) => completion.isCompleted);
  const piecesPlaced = finished.reduce((sum, completion) => {
    const info = completion.ownedPuzzleId
      ? infoByCopyId.get(completion.ownedPuzzleId)
      : undefined;
    // Borrowed copies aren't in the viewer's library join, so fall back to the durable snapshot
    // the backend denormalized at solve time.
    const snapshot =
      "copySnapshot" in completion ? completion.copySnapshot : undefined;
    return sum + (info?.pieceCount ?? snapshot?.pieceCount ?? 0);
  }, 0);
  const yearStart = new Date(new Date().getFullYear(), 0, 1).getTime();
  const thisYear = finished.filter(
    (completion) => (completion.endDate ?? completion.startDate) >= yearStart,
  ).length;

  // Most recent activity first, matching the log's promise.
  const sorted = [...completions].sort(
    (a, b) => (b.endDate ?? b.startDate) - (a.endDate ?? a.startDate),
  );

  return (
    <div className="flex flex-col gap-[26px]">
      {/* Divided stat row — open, no boxes */}
      <StatRow
        stats={[
          { label: t("stats.completed"), value: String(finished.length) },
          { label: t("stats.pieces"), value: piecesPlaced.toLocaleString() },
          { label: t("stats.thisYear"), value: String(thisYear) },
        ]}
      />

      {/* The log title, meta + Log Completion action now live in the shell
          page head; the stat row above stays as a distinct sub-section. */}
      <section>
        {sorted.length === 0 ? (
          <EmptyState title={t("empty")} sub={t("emptyHint")} />
        ) : (
          <div className="flex flex-col">
            {sorted.map((completion, index) => {
              const info =
                (completion.ownedPuzzleId &&
                  infoByCopyId.get(completion.ownedPuzzleId)) ||
                undefined;
              // Borrowed copies aren't in the viewer's library, so fall back to the durable
              // copySnapshot for the title and piece count.
              const snapshot =
                "copySnapshot" in completion
                  ? completion.copySnapshot
                  : undefined;
              const title = info?.title ?? snapshot?.title ?? t("title");
              const pieceCount = info?.pieceCount ?? snapshot?.pieceCount;
              const done = completion.isCompleted;
              // Whole days between start and finish, floored at one — "finished
              // in 3 days" reads better than raw milliseconds.
              const days =
                done && completion.endDate !== undefined
                  ? Math.max(
                      1,
                      Math.round(
                        (completion.endDate - completion.startDate) / 86400000,
                      ),
                    )
                  : undefined;
              const metaLine =
                done && pieceCount && days !== undefined
                  ? t("piecesFinished", { pieces: pieceCount, days })
                  : done && completion.endDate !== undefined
                    ? completion.completionTimeMinutes !== undefined
                      ? `${t("finished", { date: formatDate(completion.endDate) })} · ${formatTime(completion.completionTimeMinutes)}`
                      : t("finished", { date: formatDate(completion.endDate) })
                    : completion.completionTimeMinutes !== undefined
                      ? `${t("started", { date: formatDate(completion.startDate) })} · ${formatTime(completion.completionTimeMinutes)}`
                      : t("started", {
                          date: formatDate(completion.startDate),
                        });

              return (
                <div
                  key={completion._id}
                  className={cn(
                    "flex flex-wrap items-center gap-3.5 py-3.5",
                    index < sorted.length - 1 && "border-b",
                  )}
                >
                  <CoverChip
                    color={chipColor(index)}
                    icon={done ? CircleCheck : Clock}
                    size={44}
                  />
                  <div className="min-w-0 flex-1 basis-52">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">{title}</span>
                      {!done && (
                        <Badge variant="secondary" className="text-xs">
                          {t("inProgress")}
                        </Badge>
                      )}
                    </div>
                    <div className="text-muted-foreground mt-0.5 text-xs">
                      {metaLine}
                    </div>
                    {completion.notes && (
                      <p className="text-muted-foreground mt-1 line-clamp-1 text-xs">
                        {completion.notes}
                      </p>
                    )}
                    {completion.review && (
                      <p className="text-muted-foreground mt-1 line-clamp-1 text-xs italic">
                        {completion.review}
                      </p>
                    )}
                    {"copySnapshot" in completion &&
                      completion.copySnapshot != null && (
                        <p className="text-muted-foreground mt-0.5 text-xs">
                          {completion.copySnapshot.wasBorrowed
                            ? t("solvedBorrowedCopy")
                            : t("solvedOwnCopy")}
                          {"allPiecesPresent" in completion &&
                          completion.allPiecesPresent === false
                            ? ` — ${t("piecesMissing")}`
                            : "allPiecesPresent" in completion &&
                                completion.allPiecesPresent === true
                              ? ` — ${t("piecesComplete")}`
                              : ""}
                        </p>
                      )}
                  </div>

                  {completion.rating !== undefined && (
                    <StarRating value={completion.rating} size="sm" />
                  )}

                  <span className="text-muted-foreground w-[78px] text-right text-xs whitespace-nowrap">
                    {formatDate(completion.endDate ?? completion.startDate)}
                  </span>

                  <div className="flex items-center gap-1">
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
                        <CircleCheck className="h-4 w-4" />
                        {t("finish")}
                      </Button>
                    )}
                    {completion.aggregateId && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        title={
                          completion.rating !== undefined
                            ? t("editReview")
                            : t("addReview")
                        }
                        aria-label={
                          completion.rating !== undefined
                            ? t("editReview")
                            : t("addReview")
                        }
                        onClick={() =>
                          setDialog({
                            kind: "review",
                            completionId: completion.aggregateId!,
                            rating: completion.rating,
                            text: completion.review,
                          })
                        }
                      >
                        <Star className="h-4 w-4" />
                      </Button>
                    )}
                    {completion.aggregateId && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        title={t("edit")}
                        aria-label={t("edit")}
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
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

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
