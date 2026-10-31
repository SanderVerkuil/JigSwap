import { useUser } from "@/compat/clerk";
import { Link } from "@/compat/link";
import { usePageHeader } from "@/components/dashboard-layout/page-header-slot";
import { StatRow } from "@/components/library/stat-row";
import {
  CompletionRow,
  type CompletionDialogRequest,
  type CompletionRowData,
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
import { countsTowardThisYear } from "@/lib/completion-format";
import { pageTitle } from "@/lib/page-title";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

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
  const [dialog, setDialog] = useState<DialogState>(null);
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

  const { data: completions, isPending: completionsPending } = useQuery(
    convexQuery(gateway.solving.myCompletions, convexUser?._id ? {} : "skip"),
  );

  // The completion rows reference an owned copy by FK id only; join the member's library to
  // resolve a human title and the piece count. Built once per library load.
  const { data: ownedPuzzles } = useQuery(
    convexQuery(
      gateway.library.ownedByOwner,
      convexUser?._id
        ? { ownerId: convexUser._id as Id<"users">, includeUnavailable: true }
        : "skip",
    ),
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
  // 1 January of the member's local year, at UTC midnight like the stored solve dates.
  const yearStart = Date.UTC(new Date().getFullYear(), 0, 1);
  // Undated solves never count toward "this year"; year-only ones do when the year is this one.
  const thisYear = finished.filter((completion) =>
    countsTowardThisYear(completion, yearStart),
  ).length;

  // Most recent activity first, matching the log's promise.
  const sorted = [...completions].sort(
    (a, b) => (b.endDate ?? b.startDate) - (a.endDate ?? a.startDate),
  );

  // In-progress on top (newest-started first), finished history below. isCompleted is authoritative
  // (edit() can attach an endDate to a still-in-progress row) — never key on endDate presence.
  const inProgress = sorted
    .filter((c) => !c.isCompleted)
    .sort((a, b) => b.startDate - a.startDate);
  const history = sorted.filter((c) => c.isCompleted);

  const renderCompletionRow = (
    completion: CompletionRowData,
    index: number,
    isLast: boolean,
  ) => (
    <CompletionRow
      key={completion._id}
      completion={completion}
      info={
        (completion.ownedPuzzleId &&
          infoByCopyId.get(completion.ownedPuzzleId)) ||
        undefined
      }
      index={index}
      isLast={isLast}
      onOpenDialog={setDialog}
    />
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
            <SolveHistory rows={history} renderRow={renderCompletionRow} />
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
