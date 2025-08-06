"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageLoading } from "@/components/ui/loading";
import { useUser } from "@clerk/nextjs";
import { api } from "@jigswap/backend/convex/_generated/api";
import { Id } from "@jigswap/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowRightLeft,
  CheckCircle,
  Clock,
  Filter,
  MessageCircle,
  Package,
  User,
  XCircle,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

type ExchangeStatus =
  | "proposed"
  | "accepted"
  | "rejected"
  | "completed"
  | "cancelled"
  | "disputed";

export default function ExchangesPage() {
  const { user } = useUser();
  const t = useTranslations("trades");
  const tCommon = useTranslations("common");

  const [activeTab, setActiveTab] = useState<
    "incoming" | "outgoing" | "completed"
  >("incoming");
  const [statusFilter, setStatusFilter] = useState<ExchangeStatus | "all">(
    "all",
  );

  const convexUser = useQuery(
    api.users.getUserByClerkId,
    user?.id ? { clerkId: user.id } : "skip",
  );

  // Get incoming trade requests (where user is the owner)
  const incomingExchanges = useQuery(api.exchanges.getExchangesByOwner);

  // Get outgoing trade requests (where user is the requester)
  const outgoingExchanges = useQuery(api.exchanges.getExchangesByRequester);

  const acceptExchange = useMutation(api.exchanges.acceptExchange);
  const declineExchange = useMutation(api.exchanges.declineExchange);
  const completeExchange = useMutation(api.exchanges.completeExchange);
  const cancelExchange = useMutation(api.exchanges.cancelExchange);

  const handleAcceptExchange = async (tradeId: string) => {
    try {
      await acceptExchange({ exchangeId: tradeId as Id<"exchanges"> });
    } catch (error) {
      console.error("Failed to accept trade:", error);
    }
  };

  const handleDeclineExchange = async (tradeId: string) => {
    try {
      await declineExchange({ exchangeId: tradeId as Id<"exchanges"> });
    } catch (error) {
      console.error("Failed to decline trade:", error);
    }
  };

  const handleCompleteExchange = async (tradeId: string) => {
    try {
      await completeExchange({ exchangeId: tradeId as Id<"exchanges"> });
    } catch (error) {
      console.error("Failed to complete trade:", error);
    }
  };

  const handleCancelExchange = async (tradeId: string) => {
    try {
      await cancelExchange({ exchangeId: tradeId as Id<"exchanges"> });
    } catch (error) {
      console.error("Failed to cancel trade:", error);
    }
  };

  const getStatusBadge = (status: ExchangeStatus) => {
    const statusConfig = {
      proposed: {
        variant: "secondary" as const,
        icon: Clock,
        color: "text-yellow-600",
      },
      accepted: {
        variant: "default" as const,
        icon: CheckCircle,
        color: "text-green-600",
      },
      rejected: {
        variant: "destructive" as const,
        icon: XCircle,
        color: "text-red-600",
      },
      completed: {
        variant: "default" as const,
        icon: CheckCircle,
        color: "text-green-600",
      },
      cancelled: {
        variant: "secondary" as const,
        icon: XCircle,
        color: "text-gray-600",
      },
      disputed: {
        variant: "secondary" as const,
        icon: XCircle,
        color: "text-gray-600",
      },
    };

    const config = statusConfig[status];
    const Icon = config.icon;

    return (
      <Badge variant={config.variant} className="flex items-center gap-1">
        <Icon className="h-3 w-3" />
        {t(status)}
      </Badge>
    );
  };

  const getExchangesForTab = () => {
    switch (activeTab) {
      case "incoming":
        return (
          incomingExchanges?.filter(
            (exchange) =>
              statusFilter === "all" || exchange.status === statusFilter,
          ) || []
        );
      case "outgoing":
        return (
          outgoingExchanges?.filter(
            (exchange) =>
              statusFilter === "all" || exchange.status === statusFilter,
          ) || []
        );
      case "completed":
        const allExchanges = [
          ...(incomingExchanges || []),
          ...(outgoingExchanges || []),
        ];
        return allExchanges.filter(
          (exchange) => exchange.status === "completed",
        );
      default:
        return [];
    }
  };

  const trades = getExchangesForTab();

  if (
    !user ||
    convexUser === undefined ||
    incomingExchanges === undefined ||
    outgoingExchanges === undefined
  ) {
    return <PageLoading message={tCommon("loading")} />;
  }

  return (
    <div className="container mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t("title")}</h1>
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-4">
        <div className="flex items-center bg-muted rounded-lg p-1">
          <Button
            variant={activeTab === "incoming" ? "default" : "ghost"}
            size="sm"
            onClick={() => setActiveTab("incoming")}
            className="rounded-md"
          >
            {t("incoming")} (
            {incomingExchanges?.filter(
              (exchange) => exchange.status === "proposed",
            ).length || 0}
            )
          </Button>
          <Button
            variant={activeTab === "outgoing" ? "default" : "ghost"}
            size="sm"
            onClick={() => setActiveTab("outgoing")}
            className="rounded-md"
          >
            {t("outgoing")} (
            {outgoingExchanges?.filter(
              (exchange) => exchange.status === "proposed",
            ).length || 0}
            )
          </Button>
          <Button
            variant={activeTab === "completed" ? "default" : "ghost"}
            size="sm"
            onClick={() => setActiveTab("completed")}
            className="rounded-md"
          >
            {t("completed")}
          </Button>
        </div>

        {activeTab !== "completed" && (
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <select
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as ExchangeStatus | "all")
              }
              className="px-3 py-1 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary text-sm"
            >
              <option value="all">{t("allStatuses")}</option>
              <option value="proposed">{t("proposed")}</option>
              <option value="accepted">{t("accepted")}</option>
              <option value="rejected">{t("rejected")}</option>
              <option value="cancelled">{t("cancelled")}</option>
              <option value="disputed">{t("disputed")}</option>
            </select>
          </div>
        )}
      </div>

      {/* Exchange List */}
      {trades.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <div className="text-muted-foreground">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-muted flex items-center justify-center">
                <ArrowRightLeft className="h-8 w-8" />
              </div>
              <h3 className="text-lg font-medium mb-2">{t("noExchanges")}</h3>
              <p className="text-sm">{t("noExchangesDescription")}</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {trades.map((exchange) => (
            <Card
              key={exchange._id}
              className="hover:shadow-md transition-shadow"
            >
              <CardContent className="p-6">
                <div className="flex items-start justify-between">
                  <div className="flex-1 space-y-4">
                    {/* Exchange Header */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                          <ArrowRightLeft className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <h3 className="font-semibold">
                            {activeTab === "incoming"
                              ? t("tradeRequest")
                              : t("yourRequest")}
                          </h3>
                          <p className="text-sm text-muted-foreground">
                            {new Date(exchange.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                      {getStatusBadge(exchange.status)}
                    </div>

                    {/* Exchange Details */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {/* Requested Puzzle */}
                      <div className="space-y-2">
                        <h4 className="font-medium text-sm text-muted-foreground">
                          {activeTab === "incoming"
                            ? t("theyWant")
                            : t("youWant")}
                        </h4>
                        <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                          <Package className="h-8 w-8 text-muted-foreground" />
                          <div>
                            <p className="font-medium">
                              {exchange.requestedPuzzle?.title}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {exchange.requestedPuzzle?.pieceCount} pieces
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Offered Puzzle */}
                      {exchange.offeredPuzzle && (
                        <div className="space-y-2">
                          <h4 className="font-medium text-sm text-muted-foreground">
                            {activeTab === "incoming"
                              ? t("theyOffer")
                              : t("youOffer")}
                          </h4>
                          <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                            <Package className="h-8 w-8 text-muted-foreground" />
                            <div>
                              <p className="font-medium">
                                {exchange.offeredPuzzle?.title}
                              </p>
                              <p className="text-sm text-muted-foreground">
                                {exchange.offeredPuzzle?.pieceCount} pieces
                              </p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Exchange Partner */}
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <User className="h-4 w-4" />
                      <span>
                        {activeTab === "incoming"
                          ? `${t("from")} ${exchange.requester?.name}`
                          : `${t("to")} ${exchange.owner?.name}`}
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-col gap-2 ml-6">
                    {exchange.status === "proposed" &&
                      activeTab === "incoming" && (
                        <>
                          <Button
                            size="sm"
                            onClick={() => handleAcceptExchange(exchange._id)}
                            className="flex items-center gap-2"
                          >
                            <CheckCircle className="h-4 w-4" />
                            {t("accept")}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleDeclineExchange(exchange._id)}
                            className="flex items-center gap-2"
                          >
                            <XCircle className="h-4 w-4" />
                            {t("decline")}
                          </Button>
                        </>
                      )}

                    {exchange.status === "proposed" &&
                      activeTab === "outgoing" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleCancelExchange(exchange._id)}
                          className="flex items-center gap-2"
                        >
                          <XCircle className="h-4 w-4" />
                          {t("cancel")}
                        </Button>
                      )}

                    {exchange.status === "accepted" && (
                      <Button
                        size="sm"
                        onClick={() => handleCompleteExchange(exchange._id)}
                        className="flex items-center gap-2"
                      >
                        <CheckCircle className="h-4 w-4" />
                        {t("markComplete")}
                      </Button>
                    )}

                    <Button
                      variant="ghost"
                      size="sm"
                      className="flex items-center gap-2"
                    >
                      <MessageCircle className="h-4 w-4" />
                      {t("message")}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
