'use client';

import { useUser } from '@clerk/nextjs';
import { useQuery, useConvexAuth } from 'convex/react';
import { api } from '@jigswap/backend/convex/_generated/api';
import { Package, ArrowLeftRight, Star, MessageSquare } from 'lucide-react';
import { StatsCard } from './cards/stats-card';

export function WelcomeHeader() {
  const { user } = useUser();
  const { isLoading } = useConvexAuth();

  // Get current user from Convex
  const convexUser = useQuery(
    api.users.getCurrentUser,
    isLoading ? 'skip' : {},
  );

  // Get user stats
  const userStats = useQuery(
    api.users.getUserStats,
    convexUser?._id ? { userId: convexUser._id } : 'skip',
  );

  // Get recent trades for active count
  const recentTrades = useQuery(
    api.trades.getUserTradeRequests,
    convexUser?._id ? { userId: convexUser._id } : 'skip',
  );

  if (!user || !convexUser) {
    return (
      <div className="flex items-center justify-center min-h-[75px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-jigsaw-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Setting up your account...</p>
        </div>
      </div>
    );
  }

  const activeTrades =
    recentTrades?.filter(
      (t) => t.status === 'pending' || t.status === 'accepted',
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
          title="Trades Completed"
          value={userStats?.tradesCompleted || 0}
          subtitle="Successful exchanges"
          icon={ArrowLeftRight}
        />
        <StatsCard
          title="Average Rating"
          value={
            userStats?.averageRating
              ? userStats.averageRating.toFixed(1)
              : 'N/A'
          }
          subtitle={`From ${userStats?.totalReviews || 0} reviews`}
          icon={Star}
        />
        <StatsCard
          title="Active Trades"
          value={activeTrades}
          subtitle="Ongoing negotiations"
          icon={MessageSquare}
        />
      </div>
    </div>
  );
}
