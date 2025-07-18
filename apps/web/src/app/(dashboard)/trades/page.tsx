"use client";

import { useUser } from "@clerk/nextjs";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { 
  ArrowRightLeft, 
  Clock, 
  CheckCircle, 
  XCircle, 
  MessageCircle, 
  Package,
  User,
  Calendar,
  Filter
} from "lucide-react";

type TradeStatus = "pending" | "accepted" | "declined" | "completed" | "cancelled";

export default function TradesPage() {
  const { user } = useUser();
  const t = useTranslations("trades");
  const tCommon = useTranslations("common");
  
  const [activeTab, setActiveTab] = useState<"incoming" | "outgoing" | "completed">("incoming");
  const [statusFilter, setStatusFilter] = useState<TradeStatus | "all">("all");

  const convexUser = useQuery(api.users.getUserByClerkId, 
    user?.id ? { clerkId: user.id } : "skip"
  );

  // Get incoming trade requests (where user is the owner)
  const incomingTrades = useQuery(api.trades.getTradeRequestsByOwner, 
    convexUser?._id ? { ownerId: convexUser._id } : "skip"
  );

  // Get outgoing trade requests (where user is the requester)
  const outgoingTrades = useQuery(api.trades.getTradeRequestsByRequester, 
    convexUser?._id ? { requesterId: convexUser._id } : "skip"
  );

  const acceptTrade = useMutation(api.trades.acceptTradeRequest);
  const declineTrade = useMutation(api.trades.declineTradeRequest);
  const completeTrade = useMutation(api.trades.completeTradeRequest);
  const cancelTrade = useMutation(api.trades.cancelTradeRequest);

  const handleAcceptTrade = async (tradeId: string) => {
    try {
      await acceptTrade({ tradeRequestId: tradeId as any });
    } catch (error) {
      console.error("Failed to accept trade:", error);
    }
  };

  const handleDeclineTrade = async (tradeId: string) => {
    try {
      await declineTrade({ tradeRequestId: tradeId as any });
    } catch (error) {
      console.error("Failed to decline trade:", error);
    }
  };

  const handleCompleteTrade = async (tradeId: string) => {
    try {
      await completeTrade({ tradeRequestId: tradeId as any });
    } catch (error) {
      console.error("Failed to complete trade:", error);
    }
  };

  const handleCancelTrade = async (tradeId: string) => {
    try {
      await cancelTrade({ tradeRequestId: tradeId as any });
    } catch (error) {
      console.error("Failed to cancel trade:", error);
    }
  };

  const getStatusBadge = (status: TradeStatus) => {
    const statusConfig = {
      pending: { variant: "secondary" as const, icon: Clock, color: "text-yellow-600" },
      accepted: { variant: "default" as const, icon: CheckCircle, color: "text-green-600" },
      declined: { variant: "destructive" as const, icon: XCircle, color: "text-red-600" },
      completed: { variant: "default" as const, icon: CheckCircle, color: "text-green-600" },
      cancelled: { variant: "secondary" as const, icon: XCircle, color: "text-gray-600" },
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

  const getTradesForTab = () => {
    switch (activeTab) {
      case "incoming":
        return incomingTrades?.filter(trade => 
          statusFilter === "all" || trade.status === statusFilter
        ) || [];
      case "outgoing":
        return outgoingTrades?.filter(trade => 
          statusFilter === "all" || trade.status === statusFilter
        ) || [];
      case "completed":
        const allTrades = [...(incomingTrades || []), ...(outgoingTrades || [])];
        return allTrades.filter(trade => trade.status === "completed");
      default:
        return [];
    }
  };

  const trades = getTradesForTab();

  if (!user || !convexUser) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">{tCommon("loading")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
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
            {t("incoming")} ({incomingTrades?.filter(t => t.status === "pending").length || 0})
          </Button>
          <Button
            variant={activeTab === "outgoing" ? "default" : "ghost"}
            size="sm"
            onClick={() => setActiveTab("outgoing")}
            className="rounded-md"
          >
            {t("outgoing")} ({outgoingTrades?.filter(t => t.status === "pending").length || 0})
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
              onChange={(e) => setStatusFilter(e.target.value as TradeStatus | "all")}
              className="px-3 py-1 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary text-sm"
            >
              <option value="all">{t("allStatuses")}</option>
              <option value="pending">{t("pending")}</option>
              <option value="accepted">{t("accepted")}</option>
              <option value="declined">{t("declined")}</option>
              <option value="cancelled">{t("cancelled")}</option>
            </select>
          </div>
        )}
      </div>

      {/* Trade List */}
      {trades.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <div className="text-muted-foreground">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-muted flex items-center justify-center">
                <ArrowRightLeft className="h-8 w-8" />
              </div>
              <h3 className="text-lg font-medium mb-2">{t("noTrades")}</h3>
              <p className="text-sm">{t("noTradesDescription")}</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {trades.map((trade) => (
            <Card key={trade._id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-6">
                <div className="flex items-start justify-between">
                  <div className="flex-1 space-y-4">
                    {/* Trade Header */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                          <ArrowRightLeft className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <h3 className="font-semibold">
                            {activeTab === "incoming" ? t("tradeRequest") : t("yourRequest")}
                          </h3>
                          <p className="text-sm text-muted-foreground">
                            {new Date(trade.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                      {getStatusBadge(trade.status)}
                    </div>

                    {/* Trade Details */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {/* Requested Puzzle */}
                      <div className="space-y-2">
                        <h4 className="font-medium text-sm text-muted-foreground">
                          {activeTab === "incoming" ? t("theyWant") : t("youWant")}
                        </h4>
                        <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                          <Package className="h-8 w-8 text-muted-foreground" />
                          <div>
                            <p className="font-medium">{trade.ownerPuzzle?.title}</p>
                            <p className="text-sm text-muted-foreground">
                              {trade.ownerPuzzle?.pieceCount} pieces
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Offered Puzzle */}
                      {trade.requesterPuzzle && (
                        <div className="space-y-2">
                          <h4 className="font-medium text-sm text-muted-foreground">
                            {activeTab === "incoming" ? t("theyOffer") : t("youOffer")}
                          </h4>
                          <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                            <Package className="h-8 w-8 text-muted-foreground" />
                            <div>
                              <p className="font-medium">{trade.requesterPuzzle.title}</p>
                              <p className="text-sm text-muted-foreground">
                                {trade.requesterPuzzle.pieceCount} pieces
                              </p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Trade Message */}
                    {trade.message && (
                      <div className="p-3 bg-muted/30 rounded-lg">
                        <p className="text-sm">{trade.message}</p>
                      </div>
                    )}

                    {/* Trade Partner */}
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <User className="h-4 w-4" />
                      <span>
                        {activeTab === "incoming" 
                          ? `${t("from")} ${trade.requester?.name}`
                          : `${t("to")} ${trade.owner?.name}`
                        }
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-col gap-2 ml-6">
                    {trade.status === "pending" && activeTab === "incoming" && (
                      <>
                        <Button 
                          size="sm" 
                          onClick={() => handleAcceptTrade(trade._id)}
                          className="flex items-center gap-2"
                        >
                          <CheckCircle className="h-4 w-4" />
                          {t("accept")}
                        </Button>
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => handleDeclineTrade(trade._id)}
                          className="flex items-center gap-2"
                        >
                          <XCircle className="h-4 w-4" />
                          {t("decline")}
                        </Button>
                      </>
                    )}

                    {trade.status === "pending" && activeTab === "outgoing" && (
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => handleCancelTrade(trade._id)}
                        className="flex items-center gap-2"
                      >
                        <XCircle className="h-4 w-4" />
                        {t("cancel")}
                      </Button>
                    )}

                    {trade.status === "accepted" && (
                      <Button 
                        size="sm"
                        onClick={() => handleCompleteTrade(trade._id)}
                        className="flex items-center gap-2"
                      >
                        <CheckCircle className="h-4 w-4" />
                        {t("markComplete")}
                      </Button>
                    )}

                    <Button variant="ghost" size="sm" className="flex items-center gap-2">
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