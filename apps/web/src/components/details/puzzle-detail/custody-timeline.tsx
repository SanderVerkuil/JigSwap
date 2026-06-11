"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { gateway, Id } from "@/gateway";
import { useQuery } from "convex/react";
import { ArrowRight, History, User } from "lucide-react";
import { useTranslations } from "use-intl";

interface CustodyTimelineProps {
  copyId: Id<"ownedPuzzles">;
}

// Chain-of-Custody panel on the owned-copy detail: renders the Copy's provenance (original owner ->
// each settled transfer -> current owner) from the custody read-model via the gateway.
export function CustodyTimeline({ copyId }: CustodyTimelineProps) {
  const t = useTranslations("custody");
  const timeline = useQuery(gateway.custody.timeline, { copyId });

  if (timeline === undefined) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            {t("title")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{t("loading")}</p>
        </CardContent>
      </Card>
    );
  }

  if (timeline === null) return null;

  const ownerName = (name: string | undefined | null): string => name ?? "—";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="h-5 w-5" />
          {t("title")}
        </CardTitle>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Original owner */}
        <div className="flex items-center gap-3">
          <User className="h-4 w-4 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">{t("originalOwner")}</p>
            <p className="text-sm text-muted-foreground">
              {ownerName(timeline.originalOwner?.name)}
            </p>
          </div>
        </div>

        {/* Transfers, chronological */}
        {timeline.transfers.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noTransfers")}</p>
        ) : (
          <ol className="space-y-3 border-l pl-4">
            {timeline.transfers.map((transfer, index) => (
              <li key={index} className="flex items-start gap-3">
                <ArrowRight className="h-4 w-4 mt-0.5 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">
                    {ownerName(transfer.newOwner?.name)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("transferredVia", { exchangeId: transfer.exchangeId })}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(transfer.occurredAt).toLocaleString()}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}

        {/* Current owner */}
        <div className="flex items-center gap-3 border-t pt-4">
          <User className="h-4 w-4 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">{t("currentOwner")}</p>
            <p className="text-sm text-muted-foreground">
              {ownerName(timeline.currentOwner?.name)}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
