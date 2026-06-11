"use client";

import { Link } from "@/compat/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LoadingState } from "@/components/ui/loading";
import { gateway, Id } from "@/gateway";
import { useConvexAuth, useQuery } from "convex/react";
import { Package } from "lucide-react";

export function RecentPuzzlesCard() {
  const { isLoading } = useConvexAuth();

  // Get current user from Convex
  const convexUser = useQuery(
    gateway.identity.currentUser,
    isLoading ? "skip" : {},
  );

  // Get recent puzzle instances
  const recentownedPuzzles = useQuery(
    gateway.library.ownedByOwner,
    convexUser?._id
      ? { ownerId: convexUser._id as Id<"users">, includeUnavailable: false }
      : "skip",
  );

  // Show loading state while data is being fetched
  if (
    isLoading ||
    convexUser === undefined ||
    recentownedPuzzles === undefined
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
        {recentownedPuzzles && recentownedPuzzles.length > 0 ? (
          <div className="space-y-3">
            {recentownedPuzzles.slice(0, 3).map((instance) => (
              <div
                key={instance._id}
                className="flex items-center space-x-3 p-3 border rounded-lg"
              >
                <div className="w-12 h-12 bg-muted rounded-lg flex items-center justify-center">
                  🧩
                </div>
                <div className="flex-1">
                  <p className="font-medium">
                    {instance.puzzle?.title || "Unknown Puzzle"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {instance.puzzle?.pieceCount || 0} pieces •{" "}
                    {instance.condition}
                  </p>
                </div>
                <div className="text-sm text-muted-foreground">
                  {instance.availability.forTrade ||
                  instance.availability.forSale ||
                  instance.availability.forLend
                    ? "Available"
                    : "Unavailable"}
                  {instance.availability.forTrade && " • For Trade"}
                  {instance.availability.forSale && " • For Sale"}
                  {instance.availability.forLend && " • For Lend"} •{" "}
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
            <Link href="/my-puzzles/add">
              <Button className="mt-2">Add Your First Puzzle</Button>
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
