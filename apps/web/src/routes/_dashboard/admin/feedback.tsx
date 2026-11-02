import { AdminQueryError } from "@/components/admin/admin-query-error";
import { DocFeedbackSummaryList } from "@/components/admin/doc-feedback-summary-list";
import { QueueEmpty } from "@/components/admin/queue-empty";
import { Button } from "@/components/ui/button";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { PageLoading } from "@/components/ui/loading";
import { gateway } from "@/gateway";
import { pageTitle } from "@/lib/page-title";
import { createFileRoute } from "@tanstack/react-router";
// sanctioned convex/react exception: usePaginatedQuery (see tanstack-query migration spec)
import { usePaginatedQuery } from "convex/react";
import { useTranslations } from "use-intl";

export const Route = createFileRoute("/_dashboard/admin/feedback")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "adminFeedback") }],
  }),
  component: DocFeedbackPage,
});

const FEEDBACK_PAGE_SIZE = 100;

function FeedbackQueryError({ resetError }: { resetError: () => void }) {
  return <AdminQueryError onRetry={resetError} />;
}

// Admin triage view for the public /docs "Was this page helpful?" votes,
// summarised per docs page, least helpful first. Read-only; the listing is
// admin-gated server-side.
function DocFeedbackPage() {
  // A failed page throws (usePaginatedQuery has no error state): the boundary turns it into the
  // retryable admin error, and Retry remounts the list, which subscribes again.
  return (
    <ErrorBoundary fallback={FeedbackQueryError}>
      <DocFeedback />
    </ErrorBoundary>
  );
}

function DocFeedback() {
  const t = useTranslations("admin.docFeedback");
  const tAdmin = useTranslations("admin");
  const {
    results: feedback,
    status,
    loadMore,
    isLoading,
  } = usePaginatedQuery(
    gateway.adminTriage.docFeedback,
    {},
    { initialNumItems: FEEDBACK_PAGE_SIZE },
  );

  if (status === "LoadingFirstPage") {
    return <PageLoading message={t("loading")} />;
  }

  if (feedback.length === 0) {
    return <QueueEmpty title={tAdmin("queueEmpty.title")} label={t("empty")} />;
  }

  // The votes come newest first, so with more to load the totals are those of the newest ones: the
  // page says so, rather than show them as the whole picture.
  const partial = status === "CanLoadMore" || status === "LoadingMore";
  return (
    <div className="flex flex-col gap-4">
      {partial && (
        <p className="text-sm text-muted-foreground">
          {t("partial", { count: feedback.length })}
        </p>
      )}
      <DocFeedbackSummaryList entries={feedback} />
      {partial && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            className="h-11 md:h-8"
            onClick={() => loadMore(FEEDBACK_PAGE_SIZE)}
            disabled={isLoading}
          >
            {t("loadMore")}
          </Button>
        </div>
      )}
    </div>
  );
}
