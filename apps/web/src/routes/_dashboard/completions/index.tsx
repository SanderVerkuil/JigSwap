import { useUser } from "@/compat/clerk";
import { Link } from "@/compat/link";
import { usePageHeader } from "@/components/dashboard-layout/page-header-slot";
import { StatRow } from "@/components/library/stat-row";
import {
  CompletionRow,
  type CompletionDialogRequest,
} from "@/components/solving/completion-row";
import { CompletionsEmptyState } from "@/components/solving/completions-empty-state";
import { EditCompletionDialog } from "@/components/solving/edit-completion-dialog";
import { FinishSolveDialog } from "@/components/solving/finish-solve-dialog";
import { ReviewPuzzleDialog } from "@/components/solving/review-puzzle-dialog";
import { SolveHistory } from "@/components/solving/solve-history";
import { GuideHelpButton } from "@/components/tour/guide-help-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useTourLauncher } from "@/components/whats-new/tour-launcher";
import { gateway, Id } from "@/gateway";
import { useReturnFocus } from "@/hooks/use-return-focus";
import { countsTowardThisYear } from "@/lib/completion-format";
import { groupSolveHistory, HISTORY_PAGE_SIZE } from "@/lib/completion-history";
import { pageTitle } from "@/lib/page-title";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useFormatter, useTranslations } from "use-intl";

type DialogState = CompletionDialogRequest | null;

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
  const tCommon = useTranslations("common");
  const format = useFormatter();
  const [dialog, setDialog] = useState<DialogState>(null);
  // The dialogs have no Radix trigger, so focus returns to the row action that opened them.
  const dialogOpenerRef = useReturnFocus(dialog !== null);
  const deleteCompletion = useMutation({
    mutationFn: useConvexMutation(gateway.solving.deleteCompletion),
  });
  const isDeleting = deleteCompletion.isPending;

  const { data: convexUser, isPending: convexUserPending } = useQuery(
    convexQuery(
      gateway.identity.byClerkId,
      user?.id ? { clerkId: user.id } : "skip",
    ),
  );

  // A lean row per solve: what the stats, the order and the year headings need. The full rows are
  // joined below, only for what's on screen.
  const { data: completions, isPending: completionsPending } = useQuery(
    convexQuery(
      gateway.solving.myCompletionIndex,
      convexUser?._id ? {} : "skip",
    ),
  );

  // In-progress on top (newest-started first), finished history below. isCompleted is authoritative
  // (edit() can attach an endDate to a still-in-progress row) — never key on endDate presence.
  const inProgress = useMemo(
    () =>
      (completions ?? [])
        .filter((c) => !c.isCompleted)
        .sort((a, b) => b.startDate - a.startDate),
    [completions],
  );
  const history = useMemo(
    () => (completions ?? []).filter((c) => c.isCompleted),
    [completions],
  );
  const [historyLimit, setHistoryLimit] = useState(HISTORY_PAGE_SIZE);

  // The rows on screen: every solve in progress, and the history as far as it is open.
  const shownIds = useMemo(
    () =>
      [
        ...inProgress,
        ...groupSolveHistory(history, historyLimit).groups.flatMap(
          (group) => group.rows,
        ),
      ].map((row) => row._id as Id<"completions">),
    [inProgress, history, historyLimit],
  );
  const { data: shownRows } = useQuery({
    ...convexQuery(
      gateway.solving.myCompletionsByIds,
      shownIds.length > 0 ? { completionIds: shownIds } : "skip",
    ),
    // While a longer page or a changed row loads, what's on screen stays.
    placeholderData: keepPreviousData,
  });
  const rowById = useMemo(
    () => new Map((shownRows ?? []).map((row) => [row._id as string, row])),
    [shownRows],
  );

  // The page title lives in the shell page head; publish the log meta + the Log
  // Completion action there so the body carries no duplicate section header. While the empty
  // state shows, its own button is the only Log action (and carries the tour anchor).
  const { startTour } = useTourLauncher();
  const isEmpty = completions !== undefined && completions.length === 0;
  usePageHeader(
    () => ({
      meta: isEmpty ? undefined : t("mostRecent"),
      actions: (
        <>
          <GuideHelpButton tourId="track-your-solves" startTour={startTour} />
          {!isEmpty && (
            <Button variant="brand" size="sm" asChild>
              <Link href="/completions/new" data-tour="completions-log">
                <Plus className="h-4 w-4" />
                {t("logAction")}
              </Link>
            </Button>
          )}
        </>
      ),
    }),
    [t, startTour, isEmpty],
  );

  if (
    !user ||
    convexUserPending ||
    convexUser === undefined ||
    completionsPending ||
    completions === undefined
  ) {
    return <CompletionsSkeleton />;
  }

  // Top stats, computed from the real solve log: total finished, pieces placed across those and
  // finishes within the current year.
  const piecesPlaced = history.reduce(
    (sum, completion) => sum + (completion.pieceCount ?? 0),
    0,
  );
  // 1 January of the member's local year, at UTC midnight like the stored solve dates.
  const yearStart = Date.UTC(new Date().getFullYear(), 0, 1);
  // Undated solves never count toward "this year"; year-only ones do when the year is this one.
  const thisYear = history.filter((completion) =>
    countsTowardThisYear(completion, yearStart),
  ).length;

  const renderCompletionRow = (
    { _id }: { _id: string },
    index: number,
    isLast: boolean,
  ) => {
    const completion = rowById.get(_id);
    // Still being joined, or just deleted.
    if (!completion) return <Skeleton key={_id} className="mb-2 h-14" />;
    return (
      <CompletionRow
        key={completion._id}
        completion={completion}
        info={completion.libraryInfo}
        index={index}
        isLast={isLast}
        onOpenDialog={(request, opener) => {
          dialogOpenerRef.current = opener;
          setDialog(request);
        }}
      />
    );
  };

  return (
    <div className="flex flex-col gap-[26px]">
      {/* Divided stat row — open, no boxes */}
      <StatRow
        stats={[
          { label: t("stats.completed"), value: String(history.length) },
          { label: t("stats.pieces"), value: format.number(piecesPlaced) },
          { label: t("stats.thisYear"), value: String(thisYear) },
        ]}
      />

      {/* The log title, meta + Log Completion action now live in the shell
          page head; the stat row above stays as a distinct sub-section. */}
      <section>
        {completions.length === 0 ? (
          <CompletionsEmptyState />
        ) : (
          <>
            {inProgress.length > 0 && (
              <>
                <h2
                  className="text-muted-foreground mb-2 text-sm font-medium"
                  data-tour="completions-in-progress"
                >
                  {t("inProgressSection")}
                </h2>
                <div className="mb-6 flex flex-col">
                  {inProgress.map((completion, index) =>
                    renderCompletionRow(
                      completion,
                      index,
                      index === inProgress.length - 1,
                    ),
                  )}
                </div>
              </>
            )}
            {/* Grouped by year (undated last), a page at a time. */}
            <SolveHistory
              rows={history}
              limit={historyLimit}
              onShowMore={() =>
                setHistoryLimit((current) => current + HISTORY_PAGE_SIZE)
              }
              renderRow={renderCompletionRow}
            />
          </>
        )}
      </section>

      {dialog?.kind === "finish" && (
        <FinishSolveDialog
          open
          onOpenChange={(open) => !open && setDialog(null)}
          completionId={dialog.completionId}
          minEndDate={dialog.startDate}
          puzzleTitle={dialog.puzzleTitle}
        />
      )}
      {dialog?.kind === "review" && (
        <ReviewPuzzleDialog
          open
          onOpenChange={(open) => !open && setDialog(null)}
          puzzleId={dialog.puzzleId}
          copyId={dialog.copyId}
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
          datePrecision={dialog.datePrecision}
          inProgress={dialog.inProgress}
        />
      )}
      {dialog?.kind === "delete" && (
        <Dialog
          open
          onOpenChange={(open) => !open && !isDeleting && setDialog(null)}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("deleteConfirmTitle")}</DialogTitle>
              <DialogDescription>{t("deleteConfirmBody")}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setDialog(null)}
                disabled={isDeleting}
              >
                {tCommon("cancel")}
              </Button>
              <Button
                variant="destructive"
                disabled={isDeleting}
                onClick={async () => {
                  if (!dialog.completionId) return;
                  try {
                    await deleteCompletion.mutateAsync({
                      completionId: dialog.completionId,
                    });
                    toast.success(t("deleteSuccess"));
                    setDialog(null);
                  } catch {
                    toast.error(t("deleteError"));
                  }
                }}
              >
                {t("deleteConfirm")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
