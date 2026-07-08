import { pageTitle } from "@/lib/page-title";
import { createFileRoute, Link } from "@tanstack/react-router";

import { PuzzleLifecycleAction } from "@/components/admin/puzzles/puzzle-lifecycle-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageLoading } from "@/components/ui/loading";
import { gateway } from "@/gateway";
import type { FunctionReturnType } from "convex/server";
// sanctioned convex/react exception: usePaginatedQuery (see tanstack-query migration spec)
import { usePaginatedQuery } from "convex/react";
import { Puzzle as PuzzleIcon } from "lucide-react";
import { useFormatter, useTranslations } from "use-intl";

export const Route = createFileRoute("/_dashboard/admin/puzzles/")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "adminPuzzles") }],
  }),
  component: AdminPuzzlesPage,
});

// Derived from the gateway (not `@jigswap/contracts` directly), mirroring the
// rest of the web tier (e.g. collection-stats.tsx's CollectionPuzzle).
type Row = FunctionReturnType<
  typeof gateway.admin.listPuzzleDefinitions
>["page"][number];

const STATUS_VARIANT: Record<
  Row["status"],
  "default" | "secondary" | "destructive" | "outline"
> = {
  pending: "secondary",
  approved: "default",
  rejected: "destructive",
  disabled: "outline",
};

// Admin console over EVERY catalog definition (all moderation statuses), newest first with
// load-more pagination. Approved rows can be reversibly disabled and disabled rows re-enabled
// via the shared PuzzleLifecycleAction (button + AlertDialog confirm); the audit trail lands
// in the moderation Activity Log via the mutations' moderationActions stamps.
function AdminPuzzlesPage() {
  const t = useTranslations("admin.puzzles");
  const format = useFormatter();

  const {
    results: rows,
    status,
    loadMore,
    isLoading,
  } = usePaginatedQuery(
    gateway.admin.listPuzzleDefinitions,
    {},
    { initialNumItems: 25 },
  );

  if (isLoading && rows.length === 0) {
    return <PageLoading message={t("loading")} />;
  }

  return (
    <div className="space-y-4">
      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-12 text-center">
          <PuzzleIcon className="size-8 text-muted-foreground" aria-hidden />
          <p className="font-semibold">{t("empty.title")}</p>
          <p className="text-sm text-muted-foreground">
            {t("empty.description")}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border bg-card">
          {rows.map((row) => (
            <div
              key={row._id}
              className="flex items-center gap-3 border-b px-4 py-3 last:border-0"
            >
              <Link
                to="/admin/puzzles/$puzzleId"
                params={{ puzzleId: row._id }}
                className="flex min-w-0 flex-1 items-center gap-3"
              >
                {row.image ? (
                  <img
                    src={row.image}
                    alt=""
                    className="size-11 shrink-0 rounded-lg border object-cover"
                  />
                ) : (
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-lg border bg-muted">
                    <PuzzleIcon
                      className="size-5 text-muted-foreground"
                      aria-hidden
                    />
                  </span>
                )}
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="truncate font-semibold underline-offset-4 hover:underline">
                      {row.title}
                    </span>
                    <Badge variant={STATUS_VARIANT[row.status]}>
                      {t(`status.${row.status}`)}
                    </Badge>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {row.brand && `${row.brand} · `}
                    {t("pieces", { count: row.pieceCount })}
                    {row.submitterName &&
                      ` · ${t("submittedBy", { name: row.submitterName })}`}
                  </p>
                </div>
              </Link>
              <div className="hidden shrink-0 flex-col items-end gap-0.5 text-xs text-muted-foreground sm:flex">
                <span>
                  {format.dateTime(row.createdAt, { dateStyle: "medium" })}
                </span>
                <span>{t("ownerCount", { count: row.ownerCount })}</span>
              </div>
              <div className="flex shrink-0 items-center">
                <PuzzleLifecycleAction
                  aggregateId={row.aggregateId}
                  title={row.title}
                  status={row.status}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {status === "CanLoadMore" && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => loadMore(25)}
            disabled={isLoading}
          >
            {t("loadMore")}
          </Button>
        </div>
      )}
    </div>
  );
}
