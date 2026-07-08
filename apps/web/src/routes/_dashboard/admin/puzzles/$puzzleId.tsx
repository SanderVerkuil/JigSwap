import { pageTitle } from "@/lib/page-title";
import { createFileRoute, Link } from "@tanstack/react-router";

import { QueueEmpty } from "@/components/admin/queue-empty";
import { AuditList } from "@/components/admin/users/audit-list";
import { usePageHeader } from "@/components/dashboard-layout/page-header-slot";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { PageLoading } from "@/components/ui/loading";
import { gateway, type Id } from "@/gateway";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Puzzle as PuzzleIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useFormatter, useTranslations } from "use-intl";

export const Route = createFileRoute("/_dashboard/admin/puzzles/$puzzleId")({
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

// Everything the backend knows about one catalog definition that is
// admin-relevant, from the single admin/getPuzzleDefinitionDetail read model
// (gated server-side: requireMember + JWT isAdmin). Carries the same
// reversible disable/re-enable lifecycle action as the list console, behind
// the inline AlertDialog confirm.
function AdminPuzzleDetailPage() {
  const { puzzleId } = Route.useParams();
  const t = useTranslations("admin.puzzles");
  const tCommon = useTranslations("common");
  const format = useFormatter();

  const { data, isPending, isError } = useQuery(
    convexQuery(gateway.admin.getPuzzleDefinitionDetail, {
      puzzleId: puzzleId as Id<"puzzles">,
    }),
  );

  const disable = useMutation({
    mutationFn: useConvexMutation(gateway.catalog.disable),
  });
  const reenable = useMutation({
    mutationFn: useConvexMutation(gateway.catalog.reenable),
  });
  const [confirming, setConfirming] = useState<"disable" | "reenable" | null>(
    null,
  );
  const busy = disable.isPending || reenable.isPending;

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

  const runConfirmed = async () => {
    if (!confirming || !definition.aggregateId) return;
    const action = confirming;
    setConfirming(null);
    try {
      const run = action === "disable" ? disable : reenable;
      await run.mutateAsync({ puzzleDefinitionId: definition.aggregateId });
      toast.success(
        t(action === "disable" ? "disableSuccess" : "reenableSuccess", {
          title: definition.title,
        }),
      );
    } catch {
      toast.error(t(action === "disable" ? "disableError" : "reenableError"));
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border bg-card p-6">
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
          <div className="flex shrink-0 items-center">
            {definition.status === "approved" && (
              <Button
                size="sm"
                variant="outline"
                className="text-destructive hover:text-destructive"
                disabled={busy || !definition.aggregateId}
                onClick={() => setConfirming("disable")}
              >
                {t("disable")}
              </Button>
            )}
            {definition.status === "disabled" && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !definition.aggregateId}
                onClick={() => setConfirming("reenable")}
              >
                {t("reenable")}
              </Button>
            )}
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

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatTile label={t("detail.stats.owners")} value={stats.ownerCount} />
        <StatTile label={t("detail.stats.copies")} value={stats.copies.total} />
        <StatTile
          label={t("detail.stats.forTrade")}
          value={stats.copies.forTrade}
        />
        <StatTile
          label={t("detail.stats.forSale")}
          value={stats.copies.forSale}
        />
        <StatTile
          label={t("detail.stats.forLend")}
          value={stats.copies.forLend}
        />
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
        <h2 className="text-sm font-semibold">{t("detail.auditTitle")}</h2>
        <AuditList entries={audit} emptyLabel={t("detail.auditEmpty")} />
      </section>

      <AlertDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirming === "reenable"
                ? t("reenableConfirmTitle", { title: definition.title })
                : t("disableConfirmTitle", { title: definition.title })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirming === "reenable"
                ? t("reenableConfirmBody")
                : t("disableConfirmBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className={
                confirming === "disable"
                  ? buttonVariants({ variant: "destructive" })
                  : undefined
              }
              onClick={() => void runConfirmed()}
            >
              {confirming === "reenable" ? t("reenable") : t("disable")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border bg-card px-4 py-3">
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
