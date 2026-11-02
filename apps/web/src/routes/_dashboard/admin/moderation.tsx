import { AdminQueryError } from "@/components/admin/admin-query-error";
import { ActivityLog } from "@/components/admin/moderation/activity-log";
import { AdminBanner } from "@/components/admin/moderation/admin-banner";
import { AppealDetail } from "@/components/admin/moderation/appeal-detail";
import { CsamEscalationsPanel } from "@/components/admin/moderation/csam-escalations";
import {
  EditApproveDialog,
  type EditApproveValues,
} from "@/components/admin/moderation/edit-approve-dialog";
import {
  FlagDetail,
  SEVERITY_DOT,
} from "@/components/admin/moderation/flag-detail";
import { HashCheckHealth } from "@/components/admin/moderation/hash-check-health";
import { KpiRow } from "@/components/admin/moderation/kpi-row";
import {
  validateModerationSearch,
  type ModerationTab,
  type ReportStatus,
} from "@/components/admin/moderation/moderation-search";
import { PinnedDetail } from "@/components/admin/moderation/pinned-detail";
import { QueueList } from "@/components/admin/moderation/queue-list";
import { RejectSubmissionDialog } from "@/components/admin/moderation/reject-submission-dialog";
import { ReportsQueue } from "@/components/admin/moderation/reports-queue";
import { ScreeningHealth } from "@/components/admin/moderation/screening-health";
import { severityBand } from "@/components/admin/moderation/severity";
import {
  SubmissionCover,
  SubmissionDetail,
  type PendingSubmission,
} from "@/components/admin/moderation/submission-detail";
import {
  UncheckedDetail,
  type UncheckedPhoto,
} from "@/components/admin/moderation/unchecked-detail";
import { useLinkedItem } from "@/components/admin/moderation/use-linked-item";
import {
  usePinnedSelection,
  type PinnedSelection,
} from "@/components/admin/moderation/use-pinned-selection";
import { uncheckedQueueCount } from "@/components/admin/pending-counts";
import { QueueEmpty } from "@/components/admin/queue-empty";
import { convexErrorCode } from "@/components/exchange/request-trade";
import { PageLoading } from "@/components/ui/loading";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  StickyTabsBar,
  TAB_TRIGGER_CLASS,
  TabCount,
  UNDERLINE_TABS_LIST_CLASS,
} from "@/components/ui/underline-tabs";
import { gateway } from "@/gateway";
import { useRelativeTime } from "@/hooks/use-relative-time";
import { pageTitle } from "@/lib/page-title";
import { cn } from "@/lib/utils";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Flag,
  History,
  Inbox,
  MessageSquareWarning,
  Scale,
  ScanEye,
  ShieldAlert,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

// The tabs that are list+detail queues.
type QueueTab = Extract<
  ModerationTab,
  "submissions" | "flagged" | "unchecked" | "appeals"
>;

export const Route = createFileRoute("/_dashboard/admin/moderation")({
  // The open tab, the selected queue item and the Reports tab's filter and drawer live in the
  // URL (moderation-search.ts), so Back, a reload, a shared link and a notification restore them.
  validateSearch: validateModerationSearch,
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "adminModeration") }],
  }),
  component: ModerationPage,
});

// The moderation console: KPI week row + three underline tabs. Submissions is
// the live queue (list+detail split with approve / edit&approve / reject with a
// reason the submitter is told),
// Flagged Images reviews the auto-rejected photos (restore / confirm removal),
// Unchecked Photos lets an admin approve or reject photos the classifier has
// not decided (pending / unscored) or whose hash check timed out, or check an unscored one again,
// Hash matches lists the CSAM hash-list matches to report (metadata only, never an image),
// Review Requests decides the auto-rejected message photos whose sender asked for a review
// (restore / keep removed), and Activity Log pages through every moderation stamp
// (filterable by kind and acting admin, both in the URL).
function ModerationPage() {
  const t = useTranslations("admin.moderation");
  const tAdmin = useTranslations("admin");
  const relativeTime = useRelativeTime();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const tab: ModerationTab = search.tab ?? "submissions";
  // The URL's `item` belongs to the open tab's queue; the other queues see no selection.
  const itemFor = (queue: ModerationTab) =>
    tab === queue ? search.item : undefined;

  // Every console state change replaces the history entry and keeps the scroll position: it is a
  // view change on the same page, not a new page.
  const replaceSearch = (
    update: (prev: typeof search) => typeof search,
  ): void => {
    void navigate({ search: update, replace: true, resetScroll: false });
  };
  // An item the console did not put in the URL itself is a link (say a notification's), and below
  // lg a link has to open the detail Sheet even when the queue is already on screen.
  const { linkToken, noteOwnWrite } = useLinkedItem(search.item);
  // Selects a row of `queue`. A no-op once the reviewer has moved to another tab (a decision that
  // resolves after a tab switch must not plant its next item in the new tab).
  const selectItem = (queue: ModerationTab) => (id: string | null) => {
    noteOwnWrite(id ?? undefined);
    replaceSearch((prev) =>
      (prev.tab ?? "submissions") === queue
        ? { ...prev, item: id ?? undefined }
        : prev,
    );
  };
  // A tab switch starts the new tab clean: the item, report and filter belong to the old one.
  const changeTab = (value: string) => {
    const next = validateModerationSearch({ tab: value }).tab;
    replaceSearch(() => ({
      tab: next === "submissions" ? undefined : next,
    }));
  };

  // Each queue's query result is kept whole so its tab can tell a failure
  // (AdminQueryError + Retry) from loading; `data` alone is undefined in both.
  const pendingQuery = useQuery(convexQuery(gateway.catalog.pending, {}));
  const pending = pendingQuery.data;
  // One subscription serves both the tab's count pill and the tab body.
  const flaggedQuery = useQuery(
    convexQuery(gateway.admin.listRejectedPhotos, {}),
  );
  const flagged = flaggedQuery.data;
  const uncheckedQuery = useQuery(
    convexQuery(gateway.admin.listUncheckedPhotos, {}),
  );
  const unchecked = uncheckedQuery.data;
  const decideUnchecked = useMutation({
    mutationFn: useConvexMutation(gateway.admin.decideUncheckedPhoto),
  });
  const recheckPhoto = useMutation({
    mutationFn: useConvexMutation(gateway.admin.recheckPhoto),
  });
  // Message photos the check stopped whose sender asked for a review (oldest request first).
  const appealsQuery = useQuery(
    convexQuery(gateway.admin.listImageReviewRequests, {}),
  );
  const appeals = appealsQuery.data;
  const decideAppeal = useMutation({
    mutationFn: useConvexMutation(gateway.admin.decideImageReview),
  });
  const csamQuery = useQuery(
    convexQuery(gateway.admin.listCsamEscalations, {}),
  );
  const csam = csamQuery.data;
  const markCsam = useMutation({
    mutationFn: useConvexMutation(gateway.admin.markCsamEscalation),
  });
  // Bounded counts (admin/getPendingCounts) for the queues whose tab does not load the whole
  // queue: Reports.
  const { data: pendingCounts } = useQuery(
    convexQuery(gateway.admin.pendingCounts, {}),
  );
  const approve = useMutation({
    mutationFn: useConvexMutation(gateway.catalog.approve),
  });
  const reject = useMutation({
    mutationFn: useConvexMutation(gateway.catalog.reject),
  });
  const update = useMutation({
    mutationFn: useConvexMutation(gateway.catalog.updatePuzzle),
  });
  const confirmRemoval = useMutation({
    mutationFn: useConvexMutation(gateway.admin.confirmPhotoRemoval),
  });
  const restorePhoto = useMutation({
    mutationFn: useConvexMutation(gateway.admin.restorePhoto),
  });

  // Edit & Approve works on the submission it was opened for, captured here: each opening is its
  // own session (the dialog's key), so the form is seeded once per opening and Save can only ever
  // approve that submission, whatever happens to the queue meanwhile. `decidedHere` is set while
  // (and after) this reviewer's own save takes the submission out of the queue, so only someone
  // else's decision reads as "handled elsewhere"; a failed save withdraws it.
  const [edit, setEdit] = useState<{
    submission: PendingSubmission;
    open: boolean;
    session: number;
    decidedHere?: boolean;
  } | null>(null);
  const openEdit = (submission: PendingSubmission) =>
    setEdit((prev) => ({
      submission,
      open: true,
      session: (prev?.session ?? 0) + 1,
    }));
  const closeEdit = () => setEdit((prev) => prev && { ...prev, open: false });
  const setEditDecidedHere = (decidedHere: boolean) =>
    setEdit((prev) => prev && { ...prev, decidedHere });
  const editTargetPending =
    edit !== null &&
    pending?.some((submission) => submission._id === edit.submission._id) ===
      true;
  // Reject works the same way: the dialog asks for the reason the submitter is told, and rejects
  // only the submission it was opened for (with the duplicate the check matched, if any).
  const [rejecting, setRejecting] = useState<{
    submission: PendingSubmission;
    duplicateTitle?: string;
    open: boolean;
    session: number;
    decidedHere?: boolean;
  } | null>(null);
  const openReject = (submission: PendingSubmission, duplicateTitle?: string) =>
    setRejecting((prev) => ({
      submission,
      duplicateTitle,
      open: true,
      session: (prev?.session ?? 0) + 1,
    }));
  const closeReject = () =>
    setRejecting((prev) => prev && { ...prev, open: false });
  const setRejectDecidedHere = (decidedHere: boolean) =>
    setRejecting((prev) => prev && { ...prev, decidedHere });
  const rejectTargetPending =
    rejecting !== null &&
    pending?.some(
      (submission) => submission._id === rejecting.submission._id,
    ) === true;
  // The old code shared one busy flag across every moderation action to
  // disable the group; compose the mutations' pending states instead.
  const busy =
    approve.isPending ||
    reject.isPending ||
    update.isPending ||
    confirmRemoval.isPending ||
    restorePhoto.isPending ||
    decideUnchecked.isPending ||
    recheckPhoto.isPending ||
    decideAppeal.isPending ||
    markCsam.isPending;

  // Each list+detail queue pins its selection (use-pinned-selection.ts): a new arrival never
  // replaces it, and a row that leaves the queue without this reviewer deciding it stays on screen
  // as "handled elsewhere" with its actions disabled. Submissions are selected (and deep-linked)
  // by their Convex `_id`, which every row has; the aggregateId is only for the mutations. A
  // pre-domain pending row has no aggregateId: it still lists, but its actions stay disabled.
  const submissions = usePinnedSelection(
    pending,
    (submission) => submission._id,
    itemFor("submissions"),
  );
  const flaggedSelection = usePinnedSelection(
    flagged,
    (photo) => photo.imageId,
    itemFor("flagged"),
  );
  const uncheckedSelection = usePinnedSelection(
    unchecked,
    (photo) => photo.key,
    itemFor("unchecked"),
  );
  const appealSelection = usePinnedSelection(
    appeals,
    (request) => request.attachmentId,
    itemFor("appeals"),
  );
  // After a decision (or Next) focus goes to the queue's detail container, never to the next
  // item's primary action, so a keyboard reviewer keeps their place and a double Enter cannot
  // decide the next item. Bumping a queue's token asks its QueueList to do that.
  const [focusTokens, setFocusTokens] = useState<Record<QueueTab, number>>({
    submissions: 0,
    flagged: 0,
    unchecked: 0,
    appeals: 0,
  });
  const focusDetail = (queue: QueueTab) =>
    setFocusTokens((tokens) => ({ ...tokens, [queue]: tokens[queue] + 1 }));

  const nextIn = (queue: QueueTab, nextId: string | null) =>
    nextId === null
      ? undefined
      : () => {
          selectItem(queue)(nextId);
          focusDetail(queue);
        };

  // Decides row `id` of `queue` here. When it is the selected row, its leaving the queue moves
  // the selection to its neighbour (rather than reporting it handled elsewhere) and the URL
  // follows, so the reviewer keeps flowing down the queue; a failure keeps the row selected and
  // toasts `failureMessage(error)` (the generic error by default). Resolves whether it succeeded.
  const decideRow = async (
    queue: QueueTab,
    selection: Pick<
      PinnedSelection<unknown>,
      "selectedId" | "nextId" | "expectRemoval"
    >,
    id: string,
    run: () => Promise<unknown>,
    failureMessage: (error: unknown) => string = () => t("error"),
  ): Promise<boolean> => {
    const isSelected = selection.selectedId === id;
    const { nextId } = selection;
    if (isSelected) selection.expectRemoval(id);
    try {
      await run();
    } catch (error) {
      if (isSelected) selection.expectRemoval(null);
      toast.error(failureMessage(error));
      return false;
    }
    if (isSelected) {
      selectItem(queue)(nextId);
      focusDetail(queue);
    }
    return true;
  };

  const approveSelected = async () => {
    const submission = submissions.item;
    if (!submission?.aggregateId || !pending || submissions.gone) return;
    const puzzleDefinitionId = submission.aggregateId;
    const done = await decideRow(
      "submissions",
      submissions,
      submission._id,
      () => approve.mutateAsync({ puzzleDefinitionId }),
    );
    if (!done) return;
    toast.success(
      t("toast.approved", {
        title: submission.title,
        count: pending.length - 1,
      }),
    );
  };

  const rejectWithReason = async (reason: string) => {
    // Always the submission the dialog was opened for, and only while it is still pending.
    const submission = rejecting?.submission;
    if (!submission?.aggregateId || !pending || !rejectTargetPending) return;
    const puzzleDefinitionId = submission.aggregateId;
    setRejectDecidedHere(true);
    const done = await decideRow(
      "submissions",
      submissions,
      submission._id,
      () => reject.mutateAsync({ puzzleDefinitionId, reason }),
    );
    if (!done) {
      setRejectDecidedHere(false);
      return;
    }
    toast.success(
      t("toast.rejected", {
        title: submission.title,
        count: pending.length - 1,
      }),
    );
    closeReject();
  };

  const editApprove = async (values: EditApproveValues) => {
    // Always the submission the dialog was opened for, and only while it is still pending.
    const submission = edit?.submission;
    if (!submission?.aggregateId || !pending || !editTargetPending) return;
    const puzzleDefinitionId = submission.aggregateId;
    setEditDecidedHere(true);
    const done = await decideRow(
      "submissions",
      submissions,
      submission._id,
      async () => {
        await update.mutateAsync({
          puzzleDefinitionId,
          title: values.title,
          description: values.description || undefined,
          brand: values.brand || undefined,
          publisher: values.publisher || undefined,
          pieceCount: values.pieceCount,
          difficulty: values.difficulty,
          tags: values.tags,
        });
        await approve.mutateAsync({ puzzleDefinitionId, edited: true });
      },
    );
    if (!done) {
      setEditDecidedHere(false);
      return;
    }
    toast.success(
      t("toast.edited", {
        title: values.title,
        count: pending.length - 1,
      }),
    );
    closeEdit();
  };

  // The flagged queue mirrors the submissions flow: act on the selection and toast with the
  // remaining count.
  const moderateFlag = async (action: "remove" | "restore") => {
    const photo = flaggedSelection.item;
    if (!photo || !flagged || flaggedSelection.gone) return;
    const run = action === "remove" ? confirmRemoval : restorePhoto;
    const done = await decideRow(
      "flagged",
      flaggedSelection,
      photo.imageId,
      () => run.mutateAsync({ imageId: photo.imageId }),
    );
    if (!done) return;
    toast.success(
      t(
        action === "remove"
          ? "toast.removed"
          : photo.hashTimedOut
            ? "toast.restoredToUnchecked"
            : "toast.restored",
        {
          title: photo.puzzleTitle,
          count: flagged.length - 1,
        },
      ),
    );
  };

  // The unchecked-photos queue: same flow (act on the selection, toast the remaining count).
  const decide = async (
    photo: UncheckedPhoto,
    decision: "approve" | "waive_hash_check" | "reject",
  ) => {
    if (!unchecked || uncheckedSelection.gone) return;
    const done = await decideRow(
      "unchecked",
      uncheckedSelection,
      photo.key,
      () =>
        decideUnchecked.mutateAsync({
          source: photo.source,
          imageId: photo.imageId,
          decision,
        }),
    );
    if (!done) return;
    toast.success(
      t(
        decision === "approve"
          ? "toast.manualApproved"
          : decision === "waive_hash_check"
            ? "toast.hashCheckWaived"
            : "toast.manualRejected",
        {
          title: photo.puzzleTitle,
          count: unchecked.length - 1,
        },
      ),
    );
  };

  // A review request: restore the photo, or keep it removed. The server refuses a request that is
  // no longer awaiting a decision (another admin decided it) and a restore without a passed hash
  // check or a stored file; each gets its own toast rather than the generic error.
  const decideReview = async (decision: "restore" | "uphold") => {
    const request = appealSelection.item;
    if (!request || !appeals || appealSelection.gone) return;
    const done = await decideRow(
      "appeals",
      appealSelection,
      request.attachmentId,
      () =>
        decideAppeal.mutateAsync({
          attachmentId: request.attachmentId,
          decision,
        }),
      (error) => {
        const code = convexErrorCode(error);
        return code === "NotAwaitingReview"
          ? t("appeal.notAwaiting")
          : code === "CannotRestore"
            ? t("appeal.cannotRestore")
            : t("error");
      },
    );
    if (!done) return;
    toast.success(
      t(decision === "restore" ? "toast.appealRestored" : "toast.appealKept", {
        count: appeals.length - 1,
      }),
    );
  };

  // An unscored photo back through the pipeline: it turns "pending" and stays in the queue until
  // the check decides it, so the selection stays put.
  const recheck = async (photo: UncheckedPhoto) => {
    try {
      await recheckPhoto.mutateAsync({
        source: photo.source,
        imageId: photo.imageId,
      });
      toast.success(t("toast.recheckQueued", { title: photo.puzzleTitle }));
    } catch {
      toast.error(t("error"));
    }
  };

  const selectedSubmission = submissions.item;
  const uncheckedPhoto = uncheckedSelection.item;
  // The unchecked list stops at a per-source limit, so its length alone could look exact.
  const uncheckedCount = unchecked && uncheckedQueueCount(unchecked);

  return (
    <div className="space-y-6">
      <AdminBanner />
      <ScreeningHealth />
      <HashCheckHealth hashCheck={csam?.hashCheck} />
      <KpiRow />

      <Tabs value={tab} onValueChange={changeTab} className="gap-4">
        <StickyTabsBar>
          {/* Seven tabs do not fit a 1440 screen, and the list scrolls sideways. Hash matches and
              Reports carry deadlines, so they stay ahead of the tabs that scroll out of view. */}
          <TabsList className={UNDERLINE_TABS_LIST_CLASS}>
            <TabsTrigger value="submissions" className={TAB_TRIGGER_CLASS}>
              <Inbox aria-hidden />
              {t("tabs.submissions")}
              <TabCount count={pending?.length} />
            </TabsTrigger>
            <TabsTrigger value="flagged" className={TAB_TRIGGER_CLASS}>
              <Flag aria-hidden />
              {t("tabs.flagged")}
              <TabCount count={flagged?.length} />
            </TabsTrigger>
            <TabsTrigger value="unchecked" className={TAB_TRIGGER_CLASS}>
              <ScanEye aria-hidden />
              {t("tabs.unchecked")}
              <TabCount
                count={uncheckedCount?.count}
                capped={uncheckedCount?.capped}
              />
            </TabsTrigger>
            <TabsTrigger value="hashMatches" className={TAB_TRIGGER_CLASS}>
              <ShieldAlert aria-hidden />
              {t("tabs.hashMatches")}
              <TabCount
                count={
                  csam?.escalations.filter((e) => e.status === "open").length
                }
              />
            </TabsTrigger>
            <TabsTrigger value="reports" className={TAB_TRIGGER_CLASS}>
              <MessageSquareWarning aria-hidden />
              {t("tabs.reports")}
              <TabCount
                count={pendingCounts?.reports.count}
                capped={pendingCounts?.reports.capped}
              />
            </TabsTrigger>
            <TabsTrigger value="appeals" className={TAB_TRIGGER_CLASS}>
              <Scale aria-hidden />
              {t("tabs.appeals")}
              <TabCount count={appeals?.length} />
            </TabsTrigger>
            <TabsTrigger value="activity" className={TAB_TRIGGER_CLASS}>
              <History aria-hidden />
              {t("tabs.activity")}
            </TabsTrigger>
          </TabsList>
        </StickyTabsBar>

        <TabsContent value="submissions">
          {pendingQuery.isError ? (
            <AdminQueryError
              onRetry={() => void pendingQuery.refetch()}
              retrying={pendingQuery.isFetching}
            />
          ) : pending === undefined ? (
            <PageLoading message={t("loading")} />
          ) : pending.length === 0 ? (
            <QueueEmpty title={tAdmin("queueEmpty.title")} label={t("empty")} />
          ) : (
            <QueueList
              items={pending}
              selectedId={submissions.selectedId}
              label={t("tabs.submissions")}
              onSelect={selectItem("submissions")}
              detailTitle={t("detail.sheetTitle.submissions")}
              focusDetailToken={focusTokens.submissions}
              defaultDetailOpen={itemFor("submissions") !== undefined}
              openDetailToken={linkToken}
              getId={(submission) => submission._id}
              renderRow={(submission) => (
                <>
                  <SubmissionCover
                    url={submission.image}
                    title={submission.title}
                    className="size-11"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      {submission.title}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {submission.brand && `${submission.brand} · `}
                      {t("pieces", { count: submission.pieceCount })}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {relativeTime(submission.createdAt)}
                  </span>
                </>
              )}
              detail={
                <PinnedDetail
                  gone={submissions.gone}
                  onNext={nextIn("submissions", submissions.nextId)}
                >
                  {selectedSubmission && (
                    <SubmissionDetail
                      submission={selectedSubmission}
                      busy={
                        busy ||
                        submissions.gone ||
                        !selectedSubmission.aggregateId
                      }
                      onApprove={approveSelected}
                      onEditApprove={() => openEdit(selectedSubmission)}
                      onReject={(duplicateTitle) =>
                        openReject(selectedSubmission, duplicateTitle)
                      }
                    />
                  )}
                </PinnedDetail>
              }
            />
          )}
        </TabsContent>

        <TabsContent value="flagged">
          {flaggedQuery.isError ? (
            <AdminQueryError
              onRetry={() => void flaggedQuery.refetch()}
              retrying={flaggedQuery.isFetching}
            />
          ) : flagged === undefined ? (
            <PageLoading message={t("flag.loading")} />
          ) : flagged.length === 0 ? (
            <QueueEmpty
              title={tAdmin("queueEmpty.title")}
              label={t("flaggedEmpty")}
            />
          ) : (
            <QueueList
              items={flagged}
              selectedId={flaggedSelection.selectedId}
              label={t("tabs.flagged")}
              onSelect={selectItem("flagged")}
              detailTitle={t("detail.sheetTitle.flagged")}
              focusDetailToken={focusTokens.flagged}
              defaultDetailOpen={itemFor("flagged") !== undefined}
              openDetailToken={linkToken}
              getId={(photo) => photo.imageId}
              renderRow={(photo) => (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span
                        className={cn(
                          "size-2 shrink-0 rounded-full",
                          SEVERITY_DOT[severityBand(photo.score)],
                        )}
                        aria-hidden
                      />
                      <span className="truncate text-sm font-semibold">
                        {photo.label ?? t("flag.unlabeled")}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {photo.puzzleTitle}
                      {photo.uploaderName && ` · ${photo.uploaderName}`}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {relativeTime(photo.uploadedAt)}
                  </span>
                </>
              )}
              detail={
                <PinnedDetail
                  gone={flaggedSelection.gone}
                  onNext={nextIn("flagged", flaggedSelection.nextId)}
                >
                  {flaggedSelection.item && (
                    // Keyed so reveal/armed state never carries over to another photo.
                    <FlagDetail
                      key={flaggedSelection.item.imageId}
                      photo={flaggedSelection.item}
                      busy={busy || flaggedSelection.gone}
                      onConfirmRemoval={() => moderateFlag("remove")}
                      onRestore={() => moderateFlag("restore")}
                    />
                  )}
                </PinnedDetail>
              }
            />
          )}
        </TabsContent>

        <TabsContent value="unchecked">
          {uncheckedQuery.isError ? (
            <AdminQueryError
              onRetry={() => void uncheckedQuery.refetch()}
              retrying={uncheckedQuery.isFetching}
            />
          ) : unchecked === undefined ? (
            <PageLoading message={t("unchecked.loading")} />
          ) : unchecked.length === 0 ? (
            <QueueEmpty
              title={tAdmin("queueEmpty.title")}
              label={t("uncheckedEmpty")}
            />
          ) : (
            <QueueList
              items={unchecked}
              selectedId={uncheckedSelection.selectedId}
              label={t("tabs.unchecked")}
              onSelect={selectItem("unchecked")}
              detailTitle={t("detail.sheetTitle.unchecked")}
              focusDetailToken={focusTokens.unchecked}
              defaultDetailOpen={itemFor("unchecked") !== undefined}
              openDetailToken={linkToken}
              getId={(photo) => photo.key}
              renderRow={(photo) => (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span
                        className={cn(
                          "size-2 shrink-0 rounded-full",
                          photo.status === "hashTimedOut"
                            ? "bg-destructive"
                            : photo.status === "unscored"
                              ? "bg-jigsaw-warning"
                              : "bg-muted-foreground",
                        )}
                        aria-hidden
                      />
                      <span className="truncate text-sm font-semibold">
                        {t(`unchecked.status.${photo.status}`)}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {photo.puzzleTitle}
                      {photo.uploaderName && ` · ${photo.uploaderName}`}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {relativeTime(photo.uploadedAt)}
                  </span>
                </>
              )}
              detail={
                <PinnedDetail
                  gone={uncheckedSelection.gone}
                  onNext={nextIn("unchecked", uncheckedSelection.nextId)}
                >
                  {uncheckedPhoto && (
                    <UncheckedDetail
                      key={uncheckedPhoto.key}
                      photo={uncheckedPhoto}
                      busy={busy || uncheckedSelection.gone}
                      onApprove={() => decide(uncheckedPhoto, "approve")}
                      onWaive={() => decide(uncheckedPhoto, "waive_hash_check")}
                      onReject={() => decide(uncheckedPhoto, "reject")}
                      onRecheck={() => recheck(uncheckedPhoto)}
                    />
                  )}
                </PinnedDetail>
              }
            />
          )}
        </TabsContent>

        <TabsContent value="appeals">
          {appealsQuery.isError ? (
            <AdminQueryError
              onRetry={() => void appealsQuery.refetch()}
              retrying={appealsQuery.isFetching}
            />
          ) : appeals === undefined ? (
            <PageLoading message={t("appeal.loading")} />
          ) : appeals.length === 0 ? (
            <QueueEmpty
              title={tAdmin("queueEmpty.title")}
              label={t("appealsEmpty")}
            />
          ) : (
            <QueueList
              items={appeals}
              selectedId={appealSelection.selectedId}
              label={t("tabs.appeals")}
              onSelect={selectItem("appeals")}
              detailTitle={t("detail.sheetTitle.appeals")}
              focusDetailToken={focusTokens.appeals}
              defaultDetailOpen={itemFor("appeals") !== undefined}
              openDetailToken={linkToken}
              getId={(request) => request.attachmentId}
              renderRow={(request) => (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span
                        className={cn(
                          "size-2 shrink-0 rounded-full",
                          SEVERITY_DOT[severityBand(request.score)],
                        )}
                        aria-hidden
                      />
                      <span className="truncate text-sm font-semibold">
                        {request.label ?? t("flag.unlabeled")}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {t("appeal.rowSource")}
                      {request.uploaderName && ` · ${request.uploaderName}`}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {relativeTime(request.reviewRequestedAt)}
                  </span>
                </>
              )}
              detail={
                <PinnedDetail
                  gone={appealSelection.gone}
                  onNext={nextIn("appeals", appealSelection.nextId)}
                >
                  {appealSelection.item && (
                    <AppealDetail
                      key={appealSelection.item.attachmentId}
                      request={appealSelection.item}
                      busy={busy || appealSelection.gone}
                      onRestore={() => decideReview("restore")}
                      onKeepRemoved={() => decideReview("uphold")}
                    />
                  )}
                </PinnedDetail>
              }
            />
          )}
        </TabsContent>

        <TabsContent value="hashMatches">
          {csamQuery.isError ? (
            <AdminQueryError
              onRetry={() => void csamQuery.refetch()}
              retrying={csamQuery.isFetching}
            />
          ) : csam === undefined ? (
            <PageLoading message={t("csam.loading")} />
          ) : (
            <CsamEscalationsPanel
              data={csam}
              emptyTitle={tAdmin("queueEmpty.title")}
              busy={busy}
              onMark={async (id, status, note) => {
                try {
                  await markCsam.mutateAsync({ id, status, note });
                  toast.success(t("csam.updated"));
                } catch {
                  toast.error(t("error"));
                }
              }}
            />
          )}
        </TabsContent>

        <TabsContent value="reports">
          <ReportsQueue
            emptyTitle={tAdmin("queueEmpty.title")}
            status={search.status ?? "open"}
            openId={search.report ?? null}
            onStatusChange={(status: ReportStatus) =>
              replaceSearch((prev) => ({
                ...prev,
                status: status === "open" ? undefined : status,
              }))
            }
            onOpen={(reportId) =>
              replaceSearch((prev) => ({
                ...prev,
                report: reportId ?? undefined,
              }))
            }
          />
        </TabsContent>

        <TabsContent value="activity">
          <ActivityLog
            emptyTitle={tAdmin("queueEmpty.title")}
            kind={search.kind}
            actorId={search.actor}
            onKindChange={(kind) =>
              replaceSearch((prev) => ({ ...prev, kind }))
            }
            onClearActor={() =>
              replaceSearch((prev) => ({ ...prev, actor: undefined }))
            }
          />
        </TabsContent>
      </Tabs>

      {edit && (
        <EditApproveDialog
          key={edit.session}
          submission={edit.submission}
          open={edit.open}
          onOpenChange={(open) => !open && closeEdit()}
          onSave={editApprove}
          busy={busy}
          handledElsewhere={
            pending !== undefined && !editTargetPending && !edit.decidedHere
          }
          // Once its submission has left the queue (approved here, or handled elsewhere) the
          // Edit button that opened the dialog now belongs to the next item: land on the detail.
          onCloseAutoFocus={(event) => {
            if (editTargetPending) return;
            event.preventDefault();
            focusDetail("submissions");
          }}
        />
      )}
      {rejecting && (
        <RejectSubmissionDialog
          key={rejecting.session}
          submissionTitle={rejecting.submission.title}
          duplicateTitle={rejecting.duplicateTitle}
          open={rejecting.open}
          onOpenChange={(open) => !open && closeReject()}
          onReject={rejectWithReason}
          busy={busy}
          handledElsewhere={
            pending !== undefined &&
            !rejectTargetPending &&
            !rejecting.decidedHere
          }
          // As for Edit & Approve: once its submission has left the queue, the Reject button
          // that opened the dialog belongs to the next item, so land on the detail instead.
          onCloseAutoFocus={(event) => {
            if (rejectTargetPending) return;
            event.preventDefault();
            focusDetail("submissions");
          }}
        />
      )}
    </div>
  );
}
