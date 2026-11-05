// The admin docs-feedback view: one row per docs page (summarizeDocFeedback),
// least helpful first, linking to the page, with its comments behind a
// disclosure. Not-helpful votes — the signal worth acting on — carry the
// emphasised (destructive) tone.
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { Link } from "@tanstack/react-router";
import { ChevronDown, ThumbsDown, ThumbsUp } from "lucide-react";
import { useMemo } from "react";
import { useFormatter, useTranslations } from "use-intl";
import {
  summarizeDocFeedback,
  type DocFeedbackEntry,
  type DocFeedbackSummary,
} from "./doc-feedback-summary";

export function DocFeedbackSummaryList({
  entries,
}: {
  entries: readonly DocFeedbackEntry[];
}) {
  const summaries = useMemo(() => summarizeDocFeedback(entries), [entries]);
  return (
    <div className="rounded-xl border bg-card">
      {summaries.map((summary) => (
        <DocFeedbackRow key={summary.slug} summary={summary} />
      ))}
    </div>
  );
}

function DocFeedbackRow({ summary }: { summary: DocFeedbackSummary }) {
  const t = useTranslations("admin.docFeedback");
  const format = useFormatter();
  return (
    <div className="flex flex-col gap-2 border-b px-4 py-3 last:border-0">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <Link
          to="/docs/$"
          params={{ _splat: summary.slug }}
          className="min-w-0 text-base font-semibold [overflow-wrap:anywhere] hover:underline"
        >
          {summary.slug}
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">
            <ThumbsUp aria-hidden />
            {t("helpfulCount", { count: summary.helpful })}
          </Badge>
          {/* Theme-independent red with white text: readable in light and dark. */}
          <Badge
            variant="secondary"
            className={cn(summary.notHelpful > 0 && "bg-red-700 text-white")}
          >
            <ThumbsDown aria-hidden />
            {t("notHelpfulCount", {
              count: summary.notHelpful,
              share: format.number(summary.unhelpfulShare, {
                style: "percent",
              }),
            })}
          </Badge>
        </div>
      </div>
      {summary.comments.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger className="group flex min-h-11 items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground md:min-h-8">
            <ChevronDown
              aria-hidden
              className="size-4 transition-transform group-data-[state=open]:rotate-180"
            />
            {t("comments", { count: summary.comments.length })}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="mt-2 space-y-3 border-l-2 pl-3">
              {summary.comments.map((comment) => (
                <li key={comment.id} className="space-y-0.5">
                  <p className="text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">
                    {comment.comment}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {comment.helpful ? t("helpful") : t("notHelpful")}
                    {" • "}
                    {format.dateTime(new Date(comment.createdAt), {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                    {comment.locale && ` • ${comment.locale}`}
                  </p>
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
