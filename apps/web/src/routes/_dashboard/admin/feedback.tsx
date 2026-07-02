import { pageTitle } from "@/lib/page-title";
import { createFileRoute } from "@tanstack/react-router";

import { QueueEmpty } from "@/components/admin/queue-empty";
import { Badge } from "@/components/ui/badge";
import { PageLoading } from "@/components/ui/loading";
import { gateway } from "@/gateway";
import { useQuery } from "convex/react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { useFormatter, useTranslations } from "use-intl";

export const Route = createFileRoute("/_dashboard/admin/feedback")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "adminFeedback") }],
  }),
  component: DocFeedbackPage,
});

// Admin triage view for the public /docs "Was this page helpful?" votes,
// newest first. Read-only; the listing is admin-gated server-side.
function DocFeedbackPage() {
  const t = useTranslations("admin.docFeedback");
  const tAdmin = useTranslations("admin");
  const format = useFormatter();
  const feedback = useQuery(gateway.adminTriage.docFeedback);

  if (feedback === undefined) {
    return <PageLoading message={t("loading")} />;
  }

  if (feedback.length === 0) {
    return <QueueEmpty title={tAdmin("queueEmpty.title")} label={t("empty")} />;
  }

  return (
    <div className="rounded-xl border bg-card">
      {feedback.map((entry) => (
        <div
          key={entry._id}
          className="flex flex-col gap-3 border-b px-4 py-3 last:border-0"
        >
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-base font-semibold">{entry.slug}</span>
              {entry.helpful ? (
                <Badge variant="default" className="flex items-center gap-1">
                  <ThumbsUp className="h-3 w-3" />
                  {t("helpful")}
                </Badge>
              ) : (
                <Badge variant="secondary" className="flex items-center gap-1">
                  <ThumbsDown className="h-3 w-3" />
                  {t("notHelpful")}
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {format.dateTime(new Date(entry.createdAt), {
                dateStyle: "medium",
                timeStyle: "short",
              })}
              {entry.locale && ` • ${entry.locale}`}
            </p>
          </div>
          {entry.comment && (
            <p className="text-sm whitespace-pre-wrap">{entry.comment}</p>
          )}
        </div>
      ))}
    </div>
  );
}
