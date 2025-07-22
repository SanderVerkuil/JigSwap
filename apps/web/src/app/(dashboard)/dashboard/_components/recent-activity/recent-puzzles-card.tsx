"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LoadingState } from "@/components/ui/loading";
import { api } from "@jigswap/backend/convex/_generated/api";
import { useConvexAuth, useQuery } from "convex/react";
import { Package } from "lucide-react";
import Link from "next/link";

export function RecentPuzzlesCard() {
  const { isLoading } = useConvexAuth();

  // Get current user from Convex
  const convexUser = useQuery(
    api.users.getCurrentUser,
    isLoading ? "skip" : {},
  );

  // Get recent puzzle instances
  const recentPuzzleInstances = useQuery(
    api.puzzles.getPuzzleInstancesByOwner,
    convexUser?._id
      ? { ownerId: convexUser._id, includeUnavailable: false }
      : "skip",
  );

  // Show loading state while data is being fetched
  if (
    isLoading ||
    convexUser === undefined ||
    recentPuzzleInstances === undefined
  ) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Your Recent Puzzles</CardTitle>
          <CardDescription>Puzzles you&apos;ve added recently</CardDescription>
        </CardHeader>
        <CardContent>
          <LoadingState message="Loading recent puzzles..." />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your Recent Puzzles</CardTitle>
        <CardDescription>Puzzles you&apos;ve added recently</CardDescription>
      </CardHeader>
      <CardContent>
        {recentPuzzleInstances && recentPuzzleInstances.length > 0 ? (
          <div className="space-y-3">
            {recentPuzzleInstances.slice(0, 3).map((instance) => (
              <div
                key={instance._id}
                className="flex items-center space-x-3 p-3 border rounded-lg"
              >
                <div className="w-12 h-12 bg-muted rounded-lg flex items-center justify-center">
                  🧩
                </div>
                <div className="flex-1">
                  <p className="font-medium">
                    {instance.product?.title || "Unknown Puzzle"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {instance.product?.pieceCount || 0} pieces •{" "}
                    {instance.condition}
                  </p>
                </div>
                <div className="text-sm text-muted-foreground">
                  {instance.isAvailable ? "Available" : "Unavailable"}
                </div>
              </div>
            ))}
            <Link href="/puzzles">
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
