import { pageTitle } from "@/lib/page-title";
import { createFileRoute } from "@tanstack/react-router";

import { usePageHeaderActions } from "@/components/dashboard-layout/page-header-slot";
import { LogSolveDialog } from "@/components/solving/log-solve-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageLoading } from "@/components/ui/loading";
import { gateway } from "@/gateway";
import { useDateFnsLocale } from "@/lib/date-locale";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { HandHelping, Package, User } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "use-intl";

export const Route = createFileRoute("/_dashboard/borrowed")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "borrowed") }],
  }),
  pendingComponent: () => <BorrowedPending />,
  component: BorrowedPage,
});

function BorrowedPending() {
  const tCommon = useTranslations("common");
  return <PageLoading message={tCommon("loading")} />;
}

function BorrowedPage() {
  const t = useTranslations("lending");
  const tCommon = useTranslations("common");
  const tSolve = useTranslations("solving.logSolve");
  const dateLocale = useDateFnsLocale();

  // Source of truth for "copies I'm holding on loan"; open loans where the caller is the borrower.
  const { data: borrowed, isPending } = useQuery(
    convexQuery(gateway.lending.borrowed, {}),
  );
  const returnLoan = useMutation({
    mutationFn: useConvexMutation(gateway.lending.returnLoan),
  });

  // The loan currently being returned, so we can disable just its button while the mutation runs.
  const returningId = returnLoan.isPending
    ? (returnLoan.variables?.loanId ?? null)
    : null;
  // The loan for which we are logging a solve (null = dialog closed).
  const [solveFor, setSolveFor] = useState<{
    copyId: string;
    title: string;
  } | null>(null);

  const handleReturn = async (loanId: string) => {
    try {
      await returnLoan.mutateAsync({ loanId });
    } catch (error) {
      console.error("Failed to return loan:", error);
    }
  };

  // The page title/subtitle live in the shell page head (ROUTE_META
  // `shell.pages.borrowed`); publish the borrowed-count meta there too so the
  // page body carries no duplicate header.
  const borrowedCount = (borrowed ?? []).length;
  const headerMeta = t("borrowedCount", { count: borrowedCount });
  usePageHeaderActions(
    () => (
      <span className="text-muted-foreground hidden text-sm sm:inline">
        {headerMeta}
      </span>
    ),
    [headerMeta],
  );

  if (isPending || borrowed === undefined) {
    return <PageLoading message={tCommon("loading")} />;
  }

  return (
    <div className="flex w-full flex-col gap-6">
      {borrowed.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <div className="text-muted-foreground">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-muted flex items-center justify-center">
                <HandHelping className="h-8 w-8" />
              </div>
              <h3 className="text-lg font-medium mb-2">{t("noBorrowed")}</h3>
              <p className="text-sm">{t("noBorrowedDescription")}</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {borrowed.map((loan) => (
            <Card
              key={loan.loanId}
              className="flex h-full flex-col hover:shadow-md transition-shadow"
            >
              <CardContent className="flex flex-1 flex-col gap-4 p-6">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <Package className="h-5 w-5 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <h3 className="font-semibold truncate">
                      {loan.puzzleTitle}
                    </h3>
                    <Badge variant="secondary" className="text-xs">
                      {t("pieceCount", { count: loan.pieceCount })}
                    </Badge>
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <User className="h-4 w-4" />
                    <span>
                      {t("borrowedFrom", {
                        name: loan.lender?.name ?? t("unknownMember"),
                      })}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("openedRelative", {
                      when: formatDistanceToNow(new Date(loan.openedAt), {
                        addSuffix: true,
                        locale: dateLocale,
                      }),
                    })}
                  </p>
                </div>

                <div className="mt-auto flex items-center justify-end gap-2 border-t pt-4">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setSolveFor({
                        copyId: loan.copyId,
                        title: loan.puzzleTitle,
                      })
                    }
                  >
                    {tSolve("trigger")}
                  </Button>
                  <Button
                    size="sm"
                    disabled={returningId === loan.loanId}
                    onClick={() => handleReturn(loan.loanId)}
                  >
                    {returningId === loan.loanId
                      ? t("returning")
                      : t("returnAction")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {solveFor && (
        <LogSolveDialog
          open={true}
          onOpenChange={(o) => !o && setSolveFor(null)}
          copyId={solveFor.copyId}
          puzzleTitle={solveFor.title}
          viewerIsOwner={false}
        />
      )}
    </div>
  );
}
