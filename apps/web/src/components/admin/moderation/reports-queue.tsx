"use client";

// The moderation console's Reports tab (spec 2.5): the DSA notice queue from
// admin.listReports (paginated, newest first) filtered by status. Each row
// shows reason, target summary, reporter → reported, how many open reports
// the reported member has, and age. A row opens the decision drawer
// (admin.getReport + the decide form). Admin-only: the route group already
// gates the page, and every admin function re-checks isAdmin.
import { QueueEmpty } from "@/components/admin/queue-empty";
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
import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "use-intl";
import { ReportDetail } from "./report-detail";

const STATUSES = ["open", "actioned", "dismissed"] as const;
type Status = (typeof STATUSES)[number];
const PAGE_SIZE = 25;

export function ReportsQueue({ emptyTitle }: { emptyTitle: string }) {
  const t = useTranslations("admin.moderation.reports");
  const tReasons = useTranslations("safety.report.reasons");
  const relativeTime = useRelativeTime();
  const [status, setStatus] = useState<Status>("open");
  const [openId, setOpenId] = useState<Id<"reports"> | null>(null);

  const {
    results,
    status: pageStatus,
    loadMore,
  } = usePaginatedQuery(
    gateway.admin.listReports,
    { status },
    { initialNumItems: PAGE_SIZE },
  );

  return (
    <div className="flex flex-col gap-4">
      <div
        role="group"
        aria-label={t("statusFilter")}
        className="flex flex-wrap gap-2"
      >
        {STATUSES.map((value) => (
          <Button
            key={value}
            variant={status === value ? "default" : "outline"}
            size="sm"
            className="h-11 md:h-8"
            aria-pressed={status === value}
            onClick={() => setStatus(value)}
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
              onClick={() => setOpenId(report.reportId)}
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
        onOpenChange={(open) => !open && setOpenId(null)}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader className="px-5 pb-0">
            <SheetTitle>{t("detailTitle")}</SheetTitle>
            <SheetDescription className="sr-only">
              {t("detailDescription")}
            </SheetDescription>
          </SheetHeader>
          <div className="px-5 pb-5">
            {openId && <ReportDetailLoader reportId={openId} />}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function ReportDetailLoader({ reportId }: { reportId: Id<"reports"> }) {
  const t = useTranslations("admin.moderation.reports");
  const { data: report } = useQuery(
    convexQuery(gateway.admin.getReport, { reportId }),
  );
  if (report === undefined) return <PageLoading message={t("loading")} />;
  // Keyed so a half-filled decide form never carries over to another report.
  return <ReportDetail key={report.reportId} report={report} />;
}
