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
import { Package } from 'lucide-react';

export function RecentPuzzlesCard() {
  const { isLoading } = useConvexAuth();

  // Get current user from Convex
  const convexUser = useQuery(
    api.users.getCurrentUser,
    isLoading ? 'skip' : {},
  );

  // Get recent puzzles
  const recentPuzzles = useQuery(
    api.puzzles.getPuzzlesByOwner,
    convexUser?._id
      ? { ownerId: convexUser._id, includeUnavailable: false }
      : 'skip',
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your Recent Puzzles</CardTitle>
        <CardDescription>Puzzles you&apos;ve added recently</CardDescription>
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
  );
}
