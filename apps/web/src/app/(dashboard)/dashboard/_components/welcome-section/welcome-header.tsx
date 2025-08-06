"use client";

import { useUser } from "@clerk/nextjs";
import { api } from "@jigswap/backend/convex/_generated/api";
import { useConvexAuth, useQuery } from "convex/react";
import { ArrowLeftRight, MessageSquare, Package, Star } from "lucide-react";
import { StatsCard } from "./cards/stats-card";

export function WelcomeHeader() {
  const { user } = useUser();
  const { isLoading } = useConvexAuth();

  // Get current user from Convex
  const convexUser = useQuery(
    api.users.getCurrentUser,
    isLoading ? "skip" : {},
  );

  // Get user stats
  const userStats = useQuery(
    api.users.getUserStats,
    convexUser?._id ? { userId: convexUser._id } : "skip",
  );

  // Get recent trades for active count
  const recentExchanges = useQuery(
    api.exchanges.getUserExchanges,
    convexUser?._id ? { userId: convexUser._id } : "skip",
  );

  // Show loading state while data is being fetched
  if (!user || isLoading || convexUser === undefined) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Welcome back! 🧩</h1>
          <p className="text-muted-foreground mt-2">
            Setting up your dashboard...
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-lg border bg-card p-6 space-y-4">
              <div className="space-y-2">
                <div className="h-4 w-3/4 bg-muted animate-pulse rounded" />
                <div className="h-4 w-1/2 bg-muted animate-pulse rounded" />
              </div>
              <div className="h-8 w-16 bg-muted animate-pulse rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const activeExchanges =
    recentExchanges?.filter(
      (t) =>
        t.status === "proposed" ||
        t.status === "accepted" ||
        t.status === "disputed",
    ).length || 0;

  return (
    <div className="space-y-6">
      {/* Welcome Section */}
      <div>
        <h1 className="text-3xl font-bold">
          Welcome back, {user.firstName}! 🧩
        </h1>
        <p className="text-muted-foreground mt-2">
          Here&apos;s what&apos;s happening with your puzzle trading activity.
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatsCard
          title="Puzzles Owned"
          value={userStats?.puzzlesOwned || 0}
          subtitle={`${userStats?.puzzlesAvailable || 0} available for trade`}
          icon={Package}
        />
        <StatsCard
          title="Exchanges Completed"
          value={userStats?.tradesCompleted || 0}
          subtitle="Successful exchanges"
          icon={ArrowLeftRight}
        />
        <StatsCard
          title="Average Rating"
          value={
            userStats?.averageRating
              ? userStats.averageRating.toFixed(1)
              : "N/A"
          }
          subtitle={`From ${userStats?.totalReviews || 0} reviews`}
          icon={Star}
        />
        <StatsCard
          title="Active Exchanges"
          value={activeExchanges}
          subtitle="Ongoing negotiations"
          icon={MessageSquare}
        />
      </div>
    </div>
  );
}
