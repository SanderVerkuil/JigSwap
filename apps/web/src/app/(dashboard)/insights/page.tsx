"use client";

import { PageLoading } from "@/components/ui/loading";
import { gateway } from "@/gateway";
import { useUser } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import {
  CollectionBreakdown,
  CollectionBreakdownData,
} from "./_components/collection-breakdown";
import {
  CompletionTrendsChart,
  CompletionTrendPoint,
} from "./_components/completion-trends-chart";
import { ExportButton } from "./_components/export-button";
import { PersonalStats, StatCards } from "./_components/stat-cards";
import {
  TradeActivityChart,
  TradeActivityData,
} from "./_components/trade-activity-chart";

export default function InsightsPage() {
  const { user } = useUser();
  const t = useTranslations("insights");

  // requireMember-backed queries take no args; gate on the Clerk → Convex member resolving so we
  // don't fire them while signed out (they would throw), mirroring the other dashboard pages.
  const convexUser = useQuery(
    gateway.identity.byClerkId,
    user?.id ? { clerkId: user.id } : "skip",
  );
  const ready = convexUser?._id ? {} : "skip";

  const stats = useQuery(gateway.insights.personalStats, ready) as
    | PersonalStats
    | undefined;
  const trends = useQuery(gateway.insights.completionTrends, ready) as
    | CompletionTrendPoint[]
    | undefined;
  const breakdown = useQuery(gateway.insights.collectionBreakdown, ready) as
    | CollectionBreakdownData
    | undefined;
  const trades = useQuery(gateway.insights.tradeActivity, ready) as
    | TradeActivityData
    | undefined;

  if (
    !user ||
    convexUser === undefined ||
    stats === undefined ||
    trends === undefined ||
    breakdown === undefined ||
    trades === undefined
  ) {
    return <PageLoading message={t("loading")} />;
  }

  return (
    <div className="container mx-auto space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">{t("title")}</h1>
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </div>
      </div>

      <StatCards stats={stats} />

      <div className="grid gap-4 lg:grid-cols-2">
        <CompletionTrendsChart data={trends} />
        <TradeActivityChart data={trades} />
      </div>

      <CollectionBreakdown data={breakdown} />

      <ExportButton />
    </div>
  );
}
