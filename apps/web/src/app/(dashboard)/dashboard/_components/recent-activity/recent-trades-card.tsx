'use client';

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
import Link from 'next/link';
import { ArrowLeftRight } from 'lucide-react';

export function RecentTradesCard() {
  const { isLoading } = useConvexAuth();

  // Get current user from Convex
  const convexUser = useQuery(
    api.users.getCurrentUser,
    isLoading ? 'skip' : {},
  );

  // Get recent trades
  const recentTrades = useQuery(
    api.trades.getUserTradeRequests,
    convexUser?._id ? { userId: convexUser._id } : 'skip',
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Trade Activity</CardTitle>
        <CardDescription>Your latest trade requests and offers</CardDescription>
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
  );
}
