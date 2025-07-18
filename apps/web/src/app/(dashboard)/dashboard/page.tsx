'use client';

import { useUser } from '@clerk/nextjs';
import { useQuery, useConvexAuth } from 'convex/react';
import { api } from '@jigswap/backend/convex/_generated/api';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import {
  Package,
  ArrowLeftRight,
  MessageSquare,
  Star,
  PlusCircle,
  Search,
} from 'lucide-react';

export default function DashboardPage() {
  const { user } = useUser();
  const t = useTranslations();
  const { isLoading } = useConvexAuth();

  // Get current user from Convex (this will be null until user sync completes)
  const convexUser = useQuery(
    api.users.getCurrentUser,
    isLoading ? 'skip' : {},
  );

  // Get user stats
  const userStats = useQuery(
    api.users.getUserStats,
    convexUser?._id ? { userId: convexUser._id } : 'skip',
  );

  // Get recent puzzles
  const recentPuzzles = useQuery(
    api.puzzles.getPuzzlesByOwner,
    convexUser?._id
      ? { ownerId: convexUser._id, includeUnavailable: false }
      : 'skip',
  );

  // Get recent trades
  const recentTrades = useQuery(
    api.trades.getUserTradeRequests,
    convexUser?._id ? { userId: convexUser._id } : 'skip',
  );

  if (!user) {
    return <div>Loading...</div>;
  }

  if (!convexUser) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-jigsaw-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Setting up your account...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Welcome Section */}
      <div>
        <h1 className="text-3xl font-bold">
          Welcome back, {user.firstName}! 🧩
        </h1>
        <p className="text-muted-foreground mt-2">
          Here's what's happening with your puzzle trading activity.
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Puzzles Owned</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {userStats?.puzzlesOwned || 0}
            </div>
            <p className="text-xs text-muted-foreground">
              {userStats?.puzzlesAvailable || 0} available for trade
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Trades Completed
            </CardTitle>
            <ArrowLeftRight className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {userStats?.tradesCompleted || 0}
            </div>
            <p className="text-xs text-muted-foreground">
              Successful exchanges
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Average Rating
            </CardTitle>
            <Star className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {userStats?.averageRating
                ? userStats.averageRating.toFixed(1)
                : 'N/A'}
            </div>
            <p className="text-xs text-muted-foreground">
              From {userStats?.totalReviews || 0} reviews
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Trades</CardTitle>
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {recentTrades?.filter(
                (t) => t.status === 'pending' || t.status === 'accepted',
              ).length || 0}
            </div>
            <p className="text-xs text-muted-foreground">
              Ongoing negotiations
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
          <CardDescription>Get started with common tasks</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Link href="/puzzles/new">
              <Button
                className="w-full h-20 flex flex-col space-y-2"
                variant="outline"
              >
                <PlusCircle className="h-6 w-6" />
                <span>Add New Puzzle</span>
              </Button>
            </Link>
            <Link href="/browse">
              <Button
                className="w-full h-20 flex flex-col space-y-2"
                variant="outline"
              >
                <Search className="h-6 w-6" />
                <span>Browse Puzzles</span>
              </Button>
            </Link>
            <Link href="/trades">
              <Button
                className="w-full h-20 flex flex-col space-y-2"
                variant="outline"
              >
                <ArrowLeftRight className="h-6 w-6" />
                <span>View Trades</span>
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>

      {/* Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Puzzles */}
        <Card>
          <CardHeader>
            <CardTitle>Your Recent Puzzles</CardTitle>
            <CardDescription>Puzzles you've added recently</CardDescription>
          </CardHeader>
          <CardContent>
            {recentPuzzles && recentPuzzles.length > 0 ? (
              <div className="space-y-3">
                {recentPuzzles.slice(0, 3).map((puzzle) => (
                  <div
                    key={puzzle._id}
                    className="flex items-center space-x-3 p-3 border rounded-lg"
                  >
                    <div className="w-12 h-12 bg-muted rounded-lg flex items-center justify-center">
                      🧩
                    </div>
                    <div className="flex-1">
                      <p className="font-medium">{puzzle.title}</p>
                      <p className="text-sm text-muted-foreground">
                        {puzzle.pieceCount} pieces • {puzzle.condition}
                      </p>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {puzzle.isAvailable ? 'Available' : 'Unavailable'}
                    </div>
                  </div>
                ))}
                <Link href="/my-puzzles">
                  <Button variant="outline" className="w-full">
                    View All Puzzles
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="text-center py-6">
                <Package className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">No puzzles yet</p>
                <Link href="/puzzles/new">
                  <Button className="mt-2">Add Your First Puzzle</Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Trades */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Trade Activity</CardTitle>
            <CardDescription>
              Your latest trade requests and offers
            </CardDescription>
          </CardHeader>
          <CardContent>
            {recentTrades && recentTrades.length > 0 ? (
              <div className="space-y-3">
                {recentTrades.slice(0, 3).map((trade) => (
                  <div
                    key={trade._id}
                    className="flex items-center space-x-3 p-3 border rounded-lg"
                  >
                    <div className="w-12 h-12 bg-muted rounded-lg flex items-center justify-center">
                      <ArrowLeftRight className="h-6 w-6" />
                    </div>
                    <div className="flex-1">
                      <p className="font-medium">
                        {trade.userRole === 'requester'
                          ? 'Requested'
                          : 'Received request for'}
                        : {trade.ownerPuzzle?.title}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Status: {trade.status}
                      </p>
                    </div>
                  </div>
                ))}
                <Link href="/trades">
                  <Button variant="outline" className="w-full">
                    View All Trades
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="text-center py-6">
                <ArrowLeftRight className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">No trades yet</p>
                <Link href="/browse">
                  <Button className="mt-2">Start Trading</Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
