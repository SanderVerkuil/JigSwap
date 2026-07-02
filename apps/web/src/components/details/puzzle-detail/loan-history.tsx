"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { gateway, Id } from "@/gateway";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { HandHelping, User } from "lucide-react";
import { useTranslations } from "use-intl";

interface LoanHistoryProps {
  copyId: Id<"ownedPuzzles">;
}

// A loan's status maps to a badge variant; "open" stands out as the only active state.
const STATUS_VARIANT = {
  open: "default",
  returned: "secondary",
  recalled: "outline",
} as const;

// Lending-history panel on the owned-copy detail: every time this copy has been lent out (newest
// first), read from the lending read-model via the gateway. Mirrors the custody timeline sibling.
export function LoanHistory({ copyId }: LoanHistoryProps) {
  const t = useTranslations("lending");
  const { data: loans, isPending } = useQuery(
    convexQuery(gateway.lending.copyHistory, { copyId }),
  );

  if (isPending || loans === undefined) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HandHelping className="h-5 w-5" />
            {t("historyTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{t("loading")}</p>
        </CardContent>
      </Card>
    );
  }

  const statusLabel = (status: "open" | "returned" | "recalled") =>
    status === "open"
      ? t("statusOpen")
      : status === "returned"
        ? t("statusReturned")
        : t("statusRecalled");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HandHelping className="h-5 w-5" />
          {t("historyTitle")}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {t("historyDescription")}
        </p>
      </CardHeader>
      <CardContent>
        {loans.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noHistory")}</p>
        ) : (
          <ol className="space-y-3 border-l pl-4">
            {loans.map((loan) => (
              <li key={loan.loanId} className="flex items-start gap-3">
                <User className="h-4 w-4 mt-0.5 text-muted-foreground" />
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">
                      {t("borrowedBy", {
                        name: loan.borrower.anonymous
                          ? t("anonymousMember")
                          : loan.borrower.member.name,
                      })}
                    </p>
                    <Badge
                      variant={STATUS_VARIANT[loan.status]}
                      className="text-xs"
                    >
                      {statusLabel(loan.status)}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {new Date(loan.openedAt).toLocaleDateString()}
                    {loan.closedAt
                      ? ` → ${new Date(loan.closedAt).toLocaleDateString()}`
                      : ""}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
