import { pageTitle } from "@/lib/page-title";
import { createFileRoute, Link } from "@tanstack/react-router";

import { PuzzleLifecycleAction } from "@/components/admin/puzzles/puzzle-lifecycle-action";
import { QueueEmpty } from "@/components/admin/queue-empty";
import { AuditList } from "@/components/admin/users/audit-list";
import { usePageHeader } from "@/components/dashboard-layout/page-header-slot";
import { ChangedFieldChips } from "@/components/suggest-edit/changed-field-chips";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageLoading } from "@/components/ui/loading";
import { gateway, type Id } from "@/gateway";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import type { FunctionReturnType } from "convex/server";
import { Pencil, Puzzle as PuzzleIcon } from "lucide-react";
import { useFormatter, useTranslations } from "use-intl";

export const Route = createFileRoute("/_dashboard/admin/puzzles/$puzzleId/")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "adminPuzzles") }],
  }),
  component: AdminPuzzleDetailPage,
});

const STATUS_VARIANT: Record<
  "pending" | "approved" | "rejected" | "disabled",
  "default" | "secondary" | "destructive" | "outline"
> = {
  pending: "secondary",
  approved: "default",
  rejected: "destructive",
  disabled: "outline",
};

const PROPOSAL_STATUS_VARIANT: Record<
  FunctionReturnType<
    typeof gateway.admin.listProposalsForDefinition
  >[number]["status"],
  "default" | "secondary" | "destructive" | "outline"
> = {
  pending: "secondary",
  approved: "default",
  rejected: "destructive",
  withdrawn: "outline",
};

// Everything the backend knows about one catalog definition that is
// admin-relevant, from the single admin/getPuzzleDefinitionDetail read model
// (gated server-side: requireMember + JWT isAdmin). Carries the same
// reversible disable/re-enable lifecycle action as the list console via the
// shared PuzzleLifecycleAction (button + AlertDialog confirm).
function AdminPuzzleDetailPage() {
  const { puzzleId } = Route.useParams();
  const t = useTranslations("admin.puzzles");
  const tp = useTranslations("admin.proposals");
  const format = useFormatter();

  const { data, isPending, isError } = useQuery(
    convexQuery(gateway.admin.getPuzzleDefinitionDetail, {
      puzzleId: puzzleId as Id<"puzzles">,
    }),
  );

  // `definition` (and its aggregateId) is only available after `data` loads below, but hooks
  // must stay unconditional — query with the aggregateId once known, or "" while pending/on
  // error, which the backend's by_definition index lookup simply matches nothing against.
  const { data: proposals } = useQuery(
    convexQuery(gateway.admin.listProposalsForDefinition, {
      puzzleDefinitionId: data?.definition.aggregateId ?? "",
    }),
  );

  // Publish the definition title as the page-head leaf: the shell renders the
  // route's static title as the middle crumb (Admin › Puzzles › <title>).
  usePageHeader(() => (data ? { title: data.definition.title } : {}), [data]);

  if (isPending) {
    return <PageLoading message={t("loading")} />;
  }
  // A ConvexError (unknown/deleted definition id) surfaces as a query error —
  // render the admin empty-state panel rather than crashing.
  if (isError || !data) {
    return (
      <QueueEmpty
        icon={PuzzleIcon}
        title={t("detail.notFoundTitle")}
        label={t("detail.notFound")}
      />
    );
  }

  const { definition, stats, owners, audit } = data;

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-start gap-4">
          {definition.image ? (
            <img
              src={definition.image}
              alt=""
              className="size-24 shrink-0 rounded-lg border object-cover"
            />
          ) : (
            <span className="flex size-24 shrink-0 items-center justify-center rounded-lg border bg-muted">
              <PuzzleIcon
                className="size-10 text-muted-foreground"
                aria-hidden
              />
            </span>
          )}
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-lg font-semibold">{definition.title}</span>
              <Badge variant={STATUS_VARIANT[definition.status]}>
                {t(`status.${definition.status}`)}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {definition.brand && `${definition.brand} · `}
              {t("pieces", { count: definition.pieceCount })}
            </p>
            {definition.submitter && (
              <p className="text-sm text-muted-foreground">
                {t("detail.submittedByLabel")}{" "}
                <Link
                  to="/admin/users/$userId"
                  params={{ userId: definition.submitter._id }}
                  className="font-medium text-foreground underline-offset-4 hover:underline"
                >
                  {definition.submitter.name}
                </Link>
              </p>
            )}
            {definition.aggregateId && (
              <p className="font-mono text-xs text-muted-foreground">
                {definition.aggregateId}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to="/admin/puzzles/$puzzleId/edit" params={{ puzzleId }}>
                <Pencil className="h-4 w-4" />
                {t("edit.button")}
              </Link>
            </Button>
            <PuzzleLifecycleAction
              aggregateId={definition.aggregateId}
              title={definition.title}
              status={definition.status}
            />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-4 border-t pt-4 text-xs text-muted-foreground">
          <span>
            {t("detail.created", {
              date: format.dateTime(new Date(definition.createdAt), {
                dateStyle: "medium",
              }),
            })}
          </span>
          <span>
            {t("detail.updated", {
              date: format.dateTime(new Date(definition.updatedAt), {
                dateStyle: "medium",
              }),
            })}
          </span>
        </div>
      </div>

      <div className="rounded-xl border bg-card p-4">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <div>
            <div className="text-2xl font-semibold tabular-nums">
              {stats.ownerCount}
            </div>
            <div className="text-xs text-muted-foreground">
              {t("detail.stats.owners")}
            </div>
          </div>
          <div>
            <div className="text-2xl font-semibold tabular-nums">
              {stats.copies.total}
            </div>
            <div className="text-xs text-muted-foreground">
              {t("detail.stats.copies")}
            </div>
          </div>
          <div>
            <div className="text-2xl font-semibold tabular-nums">
              {stats.copies.forTrade}
            </div>
            <div className="text-xs text-muted-foreground">
              {t("detail.stats.forTrade")}
            </div>
          </div>
          <div>
            <div className="text-2xl font-semibold tabular-nums">
              {stats.copies.forSale}
            </div>
            <div className="text-xs text-muted-foreground">
              {t("detail.stats.forSale")}
            </div>
          </div>
          <div>
            <div className="text-2xl font-semibold tabular-nums">
              {stats.copies.forLend}
            </div>
            <div className="text-xs text-muted-foreground">
              {t("detail.stats.forLend")}
            </div>
          </div>
        </div>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">{t("detail.ownersTitle")}</h2>
        {owners.length === 0 ? (
          <div className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            {t("detail.ownersEmpty")}
          </div>
        ) : (
          <div className="rounded-xl border bg-card px-4">
            {owners.map((owner) => (
              <div
                key={owner._id}
                className="flex items-center gap-3 border-b py-3 last:border-b-0"
              >
                <Link
                  to="/admin/users/$userId"
                  params={{ userId: owner._id }}
                  className="flex min-w-0 flex-1 items-center gap-3"
                >
                  <Avatar className="size-8 shrink-0">
                    {owner.avatar && (
                      <AvatarImage src={owner.avatar} alt={owner.name} />
                    )}
                    <AvatarFallback>
                      {owner.name
                        .split(" ")
                        .map((part) => part[0])
                        .join("")}
                    </AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium underline-offset-4 hover:underline">
                    {owner.name}
                    {owner.username && (
                      <span className="text-muted-foreground font-normal">
                        {" "}
                        @{owner.username}
                      </span>
                    )}
                  </span>
                </Link>
                <div className="flex shrink-0 items-center gap-1.5">
                  {owner.forTrade && (
                    <Badge variant="secondary">
                      {t("detail.stats.forTrade")}
                    </Badge>
                  )}
                  {owner.forSale && (
                    <Badge variant="secondary">
                      {t("detail.stats.forSale")}
                    </Badge>
                  )}
                  {owner.forLend && (
                    <Badge variant="secondary">
                      {t("detail.stats.forLend")}
                    </Badge>
                  )}
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {t("detail.copyCount", { count: owner.copyCount })}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">{t("detail.proposalsTitle")}</h2>
        {!proposals || proposals.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {t("detail.proposalsEmpty")}
          </p>
        ) : (
          <div className="bg-card divide-y rounded-xl border">
            {proposals.map((row) => {
              const changedCount = Object.values(row.changes).filter(
                (value) => value !== undefined,
              ).length;
              return (
                <div
                  key={row._id}
                  className="flex items-center gap-3 px-4 py-2.5"
                >
                  <Badge variant={PROPOSAL_STATUS_VARIANT[row.status]}>
                    {tp(`status.${row.status}`)}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">
                      {row.proposerName &&
                        `${tp("proposedBy", { name: row.proposerName })} · `}
                      {tp("fieldsChanged", { count: changedCount })}
                    </p>
                    {row.status === "rejected" && row.rejectionReason && (
                      <p className="text-muted-foreground truncate text-xs">
                        {row.rejectionReason}
                      </p>
                    )}
                    <ChangedFieldChips changes={row.changes} />
                  </div>
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {format.dateTime(row.createdAt, { dateStyle: "medium" })}
                  </span>
                  {row.status === "pending" && (
                    <Button variant="outline" size="sm" asChild>
                      <Link
                        to="/admin/puzzles/proposals/$proposalId"
                        params={{ proposalId: row.aggregateId }}
                      >
                        {tp("review")}
                      </Link>
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">{t("detail.auditTitle")}</h2>
        <AuditList entries={audit} emptyLabel={t("detail.auditEmpty")} />
      </section>
    </div>
  );
}
