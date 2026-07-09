import { Link } from "@/compat/link";
import { usePageHeader } from "@/components/dashboard-layout/page-header-slot";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageLoading } from "@/components/ui/loading";
import { gateway } from "@/gateway";
import { pageTitle } from "@/lib/page-title";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, Lightbulb, Puzzle as PuzzleIcon } from "lucide-react";
import { useFormatter, useTranslations } from "use-intl";

export const Route = createFileRoute("/_dashboard/admin/puzzles/proposals/")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "adminPuzzles") }],
  }),
  component: ProposalsQueuePage,
});

function ProposalsQueuePage() {
  const t = useTranslations("admin.proposals");
  const tShell = useTranslations("shell");
  const format = useFormatter();
  const { data: rows } = useQuery(
    convexQuery(gateway.admin.listPendingChangeProposals, {}),
  );

  usePageHeader(
    () => ({
      title: t("title"),
      crumbs: [
        { label: tShell("groups.admin.label"), href: "/admin" },
        { label: tShell("pages.adminPuzzles.title"), href: "/admin/puzzles" },
      ],
    }),
    [t, tShell],
  );

  if (rows === undefined) {
    return <PageLoading message={t("title")} />;
  }

  return (
    <div className="flex flex-col gap-4">
      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-12 text-center">
          <Lightbulb className="text-muted-foreground size-8" aria-hidden />
          <p className="font-semibold">{t("empty.title")}</p>
          <p className="text-muted-foreground text-sm">
            {t("empty.description")}
          </p>
        </div>
      ) : (
        <div className="bg-card rounded-xl border">
          {rows.map((row) => {
            const changedCount = Object.values(row.changes).filter(
              (value) => value !== undefined,
            ).length;
            return (
              <div
                key={row._id}
                className="flex items-center gap-3 border-b px-4 py-3 last:border-0"
              >
                {row.definitionImage ? (
                  <img
                    src={row.definitionImage}
                    alt=""
                    className="size-11 shrink-0 rounded-lg border object-cover"
                  />
                ) : (
                  <span className="bg-muted flex size-11 shrink-0 items-center justify-center rounded-lg border">
                    <PuzzleIcon
                      className="text-muted-foreground size-5"
                      aria-hidden
                    />
                  </span>
                )}
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="truncate font-semibold">
                      {row.definitionTitle}
                    </span>
                    {row.hasConflict && (
                      <Badge variant="destructive">
                        <AlertTriangle className="h-3 w-3" aria-hidden />
                        {t("conflict")}
                      </Badge>
                    )}
                  </div>
                  <p className="text-muted-foreground truncate text-xs">
                    {row.proposerName &&
                      `${t("proposedBy", { name: row.proposerName })} · `}
                    {t("fieldsChanged", { count: changedCount })}
                    {" · "}
                    {format.dateTime(row.createdAt, { dateStyle: "medium" })}
                  </p>
                  {row.comment && (
                    <p className="text-muted-foreground truncate text-xs">
                      {t("comment")}: {row.comment}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center">
                  <Button variant="outline" size="sm" asChild>
                    <Link href={`/admin/puzzles/proposals/${row.aggregateId}`}>
                      {t("review")}
                    </Link>
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
