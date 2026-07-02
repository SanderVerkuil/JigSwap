import { pageTitle } from "@/lib/page-title";
import { createFileRoute } from "@tanstack/react-router";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  const format = useFormatter();
  const feedback = useQuery(gateway.adminTriage.docFeedback);

  if (feedback === undefined) {
    return <PageLoading message={t("loading")} />;
  }

  return (
    <div className="space-y-6">
      {feedback.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            {t("empty")}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {feedback.map((entry) => (
            <Card key={entry._id}>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base">{entry.slug}</CardTitle>
                  {entry.helpful ? (
                    <Badge
                      variant="default"
                      className="flex items-center gap-1"
                    >
                      <ThumbsUp className="h-3 w-3" />
                      {t("helpful")}
                    </Badge>
                  ) : (
                    <Badge
                      variant="secondary"
                      className="flex items-center gap-1"
                    >
                      <ThumbsDown className="h-3 w-3" />
                      {t("notHelpful")}
                    </Badge>
                  )}
                </div>
                <CardDescription>
                  {format.dateTime(new Date(entry.createdAt), {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                  {entry.locale && ` • ${entry.locale}`}
                </CardDescription>
              </CardHeader>
              {entry.comment && (
                <CardContent>
                  <p className="text-sm whitespace-pre-wrap">{entry.comment}</p>
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
