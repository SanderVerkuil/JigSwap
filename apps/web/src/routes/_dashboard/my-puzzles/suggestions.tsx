import { Link } from "@/compat/link";
import { usePageHeader } from "@/components/dashboard-layout/page-header-slot";
import { ChangedFieldChips } from "@/components/suggest-edit/changed-field-chips";
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
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { PageLoading } from "@/components/ui/loading";
import { gateway } from "@/gateway";
import { pageTitle } from "@/lib/page-title";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { FunctionReturnType } from "convex/server";
import { Lightbulb, Pencil, Puzzle as PuzzleIcon, Undo2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useFormatter, useTranslations } from "use-intl";

export const Route = createFileRoute("/_dashboard/my-puzzles/suggestions")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "myPuzzles") }],
  }),
  component: MySuggestionsPage,
});

type ProposalRow = FunctionReturnType<
  typeof gateway.catalog.listMyChangeProposals
>[number];

const STATUS_VARIANT: Record<
  ProposalRow["status"],
  "default" | "secondary" | "destructive" | "outline"
> = {
  pending: "secondary",
  approved: "default",
  rejected: "destructive",
  withdrawn: "outline",
};

function MySuggestionsPage() {
  const t = useTranslations("mySuggestions");
  const tCommon = useTranslations("common");
  const format = useFormatter();
  const { data: rows } = useQuery(
    convexQuery(gateway.catalog.listMyChangeProposals, {}),
  );
  const [withdrawTarget, setWithdrawTarget] = useState<{
    changeProposalId: string;
    title: string;
  } | null>(null);

  const withdraw = useMutation({
    mutationFn: useConvexMutation(gateway.catalog.withdrawChangeProposal),
    onSuccess: () => toast.success(t("withdrawn")),
    onError: () => toast.error(t("withdrawFailed")),
  });

  usePageHeader(() => ({ title: t("title") }), [t]);

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
                className="flex items-start gap-3 border-b px-4 py-3 last:border-0"
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
                    {row.puzzleId ? (
                      <Link
                        href={`/puzzles/${row.puzzleId}`}
                        className="truncate font-semibold underline-offset-4 hover:underline"
                      >
                        {row.definitionTitle}
                      </Link>
                    ) : (
                      <span className="truncate font-semibold">
                        {row.definitionTitle}
                      </span>
                    )}
                    <Badge variant={STATUS_VARIANT[row.status]}>
                      {t(`status.${row.status}`)}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground truncate text-xs">
                    {t("fieldsChanged", { count: changedCount })}
                    {" · "}
                    {format.dateTime(row.createdAt, { dateStyle: "medium" })}
                  </p>
                  {row.comment && (
                    <p className="text-muted-foreground text-xs">
                      {t("comment")}: {row.comment}
                    </p>
                  )}
                  {row.status === "rejected" && row.rejectionReason && (
                    <p className="text-destructive text-xs">
                      {t("rejectionReason")}: {row.rejectionReason}
                    </p>
                  )}
                  <ChangedFieldChips changes={row.changes} />
                </div>
                {row.status === "pending" && (
                  <div className="flex shrink-0 items-center gap-1">
                    {row.puzzleId && (
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={`/puzzles/${row.puzzleId}/suggest-edit`}>
                          <Pencil className="h-4 w-4" />
                          {t("edit")}
                        </Link>
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setWithdrawTarget({
                          changeProposalId: row.aggregateId,
                          title: row.definitionTitle ?? "",
                        })
                      }
                    >
                      <Undo2 className="h-4 w-4" />
                      {t("withdraw")}
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <AlertDialog
        open={withdrawTarget !== null}
        onOpenChange={(open) => {
          if (!open) setWithdrawTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("withdrawConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {withdrawTarget &&
                t("withdrawConfirmBody", { title: withdrawTarget.title })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              onClick={() => {
                if (!withdrawTarget) return;
                const { changeProposalId } = withdrawTarget;
                setWithdrawTarget(null);
                withdraw.mutate({ changeProposalId });
              }}
            >
              {t("withdraw")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
