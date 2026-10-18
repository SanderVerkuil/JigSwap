"use client";

// "Your reports" under Privacy & safety: the caller's own reports
// (reports.listMyReports, newest first) as target · reason · status · date.
// The list carries only the target kind and id the reporter already held, so
// the target reads as its kind ("A message", "A member"). Status collapses to
// "Under review" (open) or "Handled" (actioned or dismissed): the outcome
// itself reached the reporter as a report_decided notification.
import { gateway } from "@/gateway";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useFormatter, useTranslations } from "use-intl";

export function MyReports() {
  const t = useTranslations("safety.myReports");
  const tReport = useTranslations("safety.report");
  const format = useFormatter();
  const { data: reports } = useQuery(
    convexQuery(gateway.reports.listMyReports, {}),
  );

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium">{t("title")}</h2>
      {reports === undefined ? (
        <div className="bg-muted h-12 animate-pulse rounded-md" aria-hidden />
      ) : reports.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("empty")}</p>
      ) : (
        <ul className="divide-y">
          {reports.map((report) => (
            <li
              key={report.reportId}
              className="flex flex-wrap items-center gap-x-2 gap-y-1 py-3 text-sm"
            >
              <span className="font-medium">
                {t(`target.${report.targetKind}`)}
              </span>
              <span aria-hidden>·</span>
              <span>{tReport(`reasons.${report.reason}`)}</span>
              <span aria-hidden>·</span>
              <span
                className={
                  report.status === "open"
                    ? "text-jigsaw-warning"
                    : "text-muted-foreground"
                }
              >
                {report.status === "open" ? t("underReview") : t("handled")}
              </span>
              <span aria-hidden>·</span>
              <time
                className="text-muted-foreground"
                dateTime={new Date(report.createdAt).toISOString()}
              >
                {format.dateTime(new Date(report.createdAt), {
                  dateStyle: "medium",
                })}
              </time>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
