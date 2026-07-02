import { pageTitle } from "@/lib/page-title";
import { createFileRoute } from "@tanstack/react-router";

import { AdminBanner } from "@/components/admin/moderation/admin-banner";
import {
  EditApproveDialog,
  type EditApproveValues,
} from "@/components/admin/moderation/edit-approve-dialog";
import { KpiRow } from "@/components/admin/moderation/kpi-row";
import { QueueList } from "@/components/admin/moderation/queue-list";
import {
  SubmissionCover,
  SubmissionDetail,
  type PendingSubmission,
} from "@/components/admin/moderation/submission-detail";
import { QueueEmpty } from "@/components/admin/queue-empty";
import { PageLoading } from "@/components/ui/loading";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { gateway } from "@/gateway";
import { useMutation, useQuery } from "convex/react";
import { Flag, History, Inbox } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useFormatter, useTranslations } from "use-intl";

export const Route = createFileRoute("/_dashboard/admin/moderation")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "adminModeration") }],
  }),
  component: ModerationPage,
});

// Underline-style restyle of the boxed shadcn tabs primitive (transparent list
// with a bottom border; the active trigger gets a primary underline).
const TAB_TRIGGER_CLASS =
  "group -mb-px flex-none gap-2 rounded-none border-0 border-b-2 border-transparent px-4 py-2.5 font-semibold text-muted-foreground data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none dark:data-[state=active]:border-primary dark:data-[state=active]:bg-transparent";

// Count pill on the queue tabs; follows the trigger's active state.
function TabCount({ count }: { count: number | undefined }) {
  if (count === undefined) return null;
  return (
    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-xs font-bold text-muted-foreground group-data-[state=active]:bg-primary group-data-[state=active]:text-primary-foreground">
      {count}
    </span>
  );
}

// The moderation console: KPI week row + three underline tabs. Submissions is
// the live queue (list+detail split with approve / edit&approve / reject);
// Flagged Images and Activity Log land in the follow-up task.
function ModerationPage() {
  const t = useTranslations("admin.moderation");
  const tAdmin = useTranslations("admin");
  const format = useFormatter();

  const pending = useQuery(gateway.catalog.pending);
  // Queried here only for the tab's count pill; the tab body is Task 9's.
  const flagged = useQuery(gateway.admin.listRejectedPhotos);
  const approve = useMutation(gateway.catalog.approve);
  const reject = useMutation(gateway.catalog.reject);
  const update = useMutation(gateway.catalog.updatePuzzle);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // A pre-domain pending row has no aggregateId; it still lists (keyed by _id)
  // but its actions stay disabled — same rule as the previous queue.
  const getId = (submission: PendingSubmission) =>
    submission.aggregateId ?? submission._id;
  const selected =
    pending?.find((submission) => getId(submission) === selectedId) ??
    pending?.[0];

  // After a decision the query refetches reactively and the row disappears;
  // pre-select its neighbour so the reviewer keeps flowing down the queue.
  const selectNext = (current: PendingSubmission) => {
    if (!pending) return;
    const index = pending.findIndex(
      (submission) => getId(submission) === getId(current),
    );
    const next = pending[index + 1] ?? pending[index - 1];
    setSelectedId(next ? getId(next) : null);
  };

  const moderate = async (action: "approve" | "reject") => {
    if (!selected?.aggregateId) return;
    setBusy(true);
    try {
      const run = action === "approve" ? approve : reject;
      await run({ puzzleDefinitionId: selected.aggregateId });
      toast.success(
        action === "approve" ? t("approveSuccess") : t("rejectSuccess"),
      );
      selectNext(selected);
    } catch {
      toast.error(t("error"));
    } finally {
      setBusy(false);
    }
  };

  const editApprove = async (values: EditApproveValues) => {
    if (!selected?.aggregateId) return;
    setBusy(true);
    try {
      await update({
        puzzleDefinitionId: selected.aggregateId,
        title: values.title,
        brand: values.brand || undefined,
        pieceCount: values.pieceCount,
        difficulty: values.difficulty,
        tags: values.tags,
      });
      await approve({
        puzzleDefinitionId: selected.aggregateId,
        edited: true,
      });
      toast.success(t("editApproveSuccess"));
      setEditOpen(false);
      selectNext(selected);
    } catch {
      toast.error(t("error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <AdminBanner />
      <KpiRow />

      <Tabs defaultValue="submissions" className="gap-4">
        <TabsList className="h-auto w-full justify-start gap-1 rounded-none border-b bg-transparent p-0">
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
          <TabsTrigger value="activity" className={TAB_TRIGGER_CLASS}>
            <History aria-hidden />
            {t("tabs.activity")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="submissions">
          {pending === undefined ? (
            <PageLoading message={t("loading")} />
          ) : pending.length === 0 ? (
            <QueueEmpty title={tAdmin("queueEmpty.title")} label={t("empty")} />
          ) : (
            <QueueList
              items={pending}
              selectedId={selected ? getId(selected) : null}
              onSelect={setSelectedId}
              getId={getId}
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
                    {format.relativeTime(submission.createdAt)}
                  </span>
                </>
              )}
              detail={
                selected && (
                  <SubmissionDetail
                    submission={selected}
                    busy={busy || !selected.aggregateId}
                    onApprove={() => moderate("approve")}
                    onEditApprove={() => setEditOpen(true)}
                    onReject={() => moderate("reject")}
                  />
                )
              }
            />
          )}
        </TabsContent>

        <TabsContent value="flagged">
          {/* Task 9 */}
          <QueueEmpty
            title={tAdmin("queueEmpty.title")}
            label={t("flaggedEmpty")}
          />
        </TabsContent>

        <TabsContent value="activity">
          {/* Task 9 */}
          <QueueEmpty
            title={tAdmin("queueEmpty.title")}
            label={t("activityEmpty")}
          />
        </TabsContent>
      </Tabs>

      {selected && (
        <EditApproveDialog
          submission={selected}
          open={editOpen}
          onOpenChange={setEditOpen}
          onSave={editApprove}
          busy={busy}
        />
      )}
    </div>
  );
}
