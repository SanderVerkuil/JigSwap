"use client";

// The moderation console's Reports tab (spec 2.5): the DSA notice queue from
// admin.listReports (paginated, newest first) filtered by status. Each row
// shows reason, target summary, reporter → reported, how many open reports
// the reported member has, and age. A row opens the decision drawer
// (admin.getReport + the decide form); from a decided report it goes on to
// the next open one (nextOpenReportId), and the member's other reports open in
// the same drawer. The status filter and the open report
// are the route's (URL search `status` / `report`), so a reload, Back or a
// shared link restores them. Admin-only: the route group already gates the
// page, and every admin function re-checks isAdmin.
import { AdminQueryError } from "@/components/admin/admin-query-error";
import { QueueEmpty } from "@/components/admin/queue-empty";
import { convexErrorCode } from "@/components/exchange/request-trade";
import { Button } from "@/components/ui/button";
import { PageLoading } from "@/components/ui/loading";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { gateway, type Id } from "@/gateway";
import { useRelativeTime } from "@/hooks/use-relative-time";
import { cn } from "@/lib/utils";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
// sanctioned convex/react exception: usePaginatedQuery (see tanstack-query migration spec)
import { usePaginatedQuery } from "convex/react";
import { ArrowRight, FileX } from "lucide-react";
import { useRef } from "react";
import { useTranslations } from "use-intl";
import { REPORT_STATUSES, type ReportStatus } from "./moderation-search";
import { ReportDetail } from "./report-detail";

const PAGE_SIZE = 25;

/**
 * The report to go on to after `current`: the next open report below it in `rows` (the loaded
 * queue, newest first), wrapping to the top. Once deciding has taken `current` out of an open
 * list, its place is found by `createdAt`, so this is the report that slid into it. Null when no
 * other open report is loaded.
 */
export function nextOpenReportId(
  rows: readonly { reportId: string; status: string; createdAt: number }[],
  current: { reportId: string; createdAt: number },
): string | null {
  const at = rows.findIndex((row) => row.reportId === current.reportId);
  const start =
    at >= 0
      ? at + 1
      : rows.findIndex((row) => row.createdAt < current.createdAt);
  const isNext = (row: (typeof rows)[number]) =>
    row.status === "open" && row.reportId !== current.reportId;
  const below = start >= 0 ? rows.slice(start).find(isNext) : undefined;
  return (below ?? rows.find(isNext))?.reportId ?? null;
}

export function ReportsQueue({
  emptyTitle,
  status,
  openId,
  onStatusChange,
  onOpen,
}: {
  emptyTitle: string;
  status: ReportStatus;
  /** The report whose drawer is open (from the URL); null when closed. */
  openId: string | null;
  onStatusChange: (status: ReportStatus) => void;
  /** Opens a report's drawer, or closes it with null. */
  onOpen: (reportId: string | null) => void;
}) {
  const t = useTranslations("admin.moderation.reports");
  const tReasons = useTranslations("safety.report.reasons");
  const relativeTime = useRelativeTime();

  const {
    results,
    status: pageStatus,
    loadMore,
  } = usePaginatedQuery(
    gateway.admin.listReports,
    { status },
    { initialNumItems: PAGE_SIZE },
  );
  // The drawer scrolls; another report opened from inside it starts at its top.
  const drawerRef = useRef<HTMLDivElement>(null);
  const openFromDrawer = (reportId: string) => {
    if (drawerRef.current) drawerRef.current.scrollTop = 0;
    onOpen(reportId);
  };

  return (
    <div className="flex flex-col gap-4">
      <div
        role="group"
        aria-label={t("statusFilter")}
        className="flex flex-wrap gap-2"
      >
        {REPORT_STATUSES.map((value) => (
          <Button
            key={value}
            variant={status === value ? "default" : "outline"}
            size="sm"
            className="h-11 md:h-8"
            aria-pressed={status === value}
            onClick={() => onStatusChange(value)}
          >
            {t(`statuses.${value}`)}
          </Button>
        ))}
      </div>

      {pageStatus === "LoadingFirstPage" ? (
        <PageLoading message={t("loading")} />
      ) : results.length === 0 ? (
        <QueueEmpty title={emptyTitle} label={t(`empty.${status}`)} />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          {results.map((report) => (
            <button
              key={report.reportId}
              type="button"
              onClick={() => onOpen(report.reportId)}
              className="flex min-h-11 w-full items-center gap-3 border-b px-3 py-3 text-left last:border-b-0 hover:bg-accent/50"
            >
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold">
                    {tReasons(report.reason)}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {t(`kinds.${report.targetKind}`)}
                  </span>
                </span>
                {report.targetSummary && (
                  <span className="mt-0.5 block truncate text-sm">
                    {report.targetSummary}
                  </span>
                )}
                <span className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                  <span className="truncate">
                    {report.reporterLabel ?? t("deletedMember")}
                  </span>
                  <ArrowRight
                    className="size-3 shrink-0"
                    aria-label={t("reportedArrow")}
                  />
                  <span className="truncate">
                    {report.reportedLabel ?? t("deletedMember")}
                  </span>
                </span>
              </span>
              <span
                className={cn(
                  "shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold",
                  report.openReportsAgainstReported > 1
                    ? "bg-destructive/10 text-destructive"
                    : "bg-muted text-muted-foreground",
                )}
                title={t("openCount", {
                  count: report.openReportsAgainstReported,
                })}
              >
                <span aria-hidden>{report.openReportsAgainstReported}</span>
                <span className="sr-only">
                  {t("openCount", {
                    count: report.openReportsAgainstReported,
                  })}
                </span>
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {relativeTime(report.createdAt)}
              </span>
            </button>
          ))}
        </div>
      )}

      {pageStatus === "CanLoadMore" && (
        <Button
          variant="outline"
          className="h-11 self-center md:h-9"
          onClick={() => loadMore(PAGE_SIZE)}
        >
          {t("loadMore")}
        </Button>
      )}

      <Sheet
        open={openId !== null}
        onOpenChange={(open) => !open && onOpen(null)}
      >
        <SheetContent
          ref={drawerRef}
          className="w-full overflow-y-auto sm:max-w-xl"
        >
          <SheetHeader className="px-5 pb-0">
            <SheetTitle>{t("detailTitle")}</SheetTitle>
            <SheetDescription className="sr-only">
              {t("detailDescription")}
            </SheetDescription>
          </SheetHeader>
          <div className="px-5 pb-5">
            {openId && (
              // The id comes from the URL; getReport validates it server-side.
              <ReportDetailLoader
                reportId={openId as Id<"reports">}
                queue={results}
                onOpenReport={openFromDrawer}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function ReportDetailLoader({
  reportId,
  queue,
  onOpenReport,
}: {
  reportId: Id<"reports">;
  /** The loaded queue rows, for the next open report. */
  queue: Parameters<typeof nextOpenReportId>[0];
  onOpenReport: (reportId: string) => void;
}) {
  const t = useTranslations("admin.moderation.reports");
  const {
    data: report,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery(convexQuery(gateway.admin.getReport, { reportId }));
  // getReport throws ConvexError NotFound for a report that is gone (a stale
  // link); any other failure gets the retryable error state, never a spinner.
  if (isError && convexErrorCode(error) === "NotFound") {
    return (
      <QueueEmpty
        icon={FileX}
        title={t("notFoundTitle")}
        label={t("notFound")}
      />
    );
  }
  if (isError) {
    return (
      <AdminQueryError onRetry={() => void refetch()} retrying={isFetching} />
    );
  }
  if (report === undefined) return <PageLoading message={t("loading")} />;
  // Keyed so a half-filled decide form never carries over to another report.
  return (
    <ReportDetail
      key={report.reportId}
      report={report}
      nextReportId={nextOpenReportId(queue, report)}
      onOpenReport={onOpenReport}
    />
  );
}
