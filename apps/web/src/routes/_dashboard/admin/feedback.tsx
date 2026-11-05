import { AdminQueryError } from "@/components/admin/admin-query-error";
import { DocFeedbackSummaryList } from "@/components/admin/doc-feedback-summary-list";
import { QueueEmpty } from "@/components/admin/queue-empty";
import { PageLoading } from "@/components/ui/loading";
import { gateway } from "@/gateway";
import { pageTitle } from "@/lib/page-title";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslations } from "use-intl";

export const Route = createFileRoute("/_dashboard/admin/feedback")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "adminFeedback") }],
  }),
  component: DocFeedbackPage,
});

// Admin triage view for the public /docs "Was this page helpful?" votes,
// summarised per docs page, least helpful first. Read-only; the listing is
// admin-gated server-side.
function DocFeedbackPage() {
  const t = useTranslations("admin.docFeedback");
  const tAdmin = useTranslations("admin");
  const {
    data: feedback,
    isError,
    refetch,
    isFetching,
  } = useQuery(convexQuery(gateway.adminTriage.docFeedback, {}));

  if (isError) {
    return (
      <AdminQueryError onRetry={() => void refetch()} retrying={isFetching} />
    );
  }
  if (feedback === undefined) {
    return <PageLoading message={t("loading")} />;
  }

  if (feedback.length === 0) {
    return <QueueEmpty title={tAdmin("queueEmpty.title")} label={t("empty")} />;
  }

  return <DocFeedbackSummaryList entries={feedback} />;
}
