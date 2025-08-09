"use client";

import { Button } from "@/components/ui/button";
import { api } from "@jigswap/backend/convex/_generated/api";
import { useQuery } from "convex/react";
import Link from "next/link";
import { PuzzleCard as ProductCard } from "../(dashboard)/puzzles/_components/puzzle-card";
import { PuzzleViewProvider } from "../(dashboard)/puzzles/_components/puzzle-view-provider";

export function HomeRecent() {
  const recentPuzzles = useQuery(api.puzzles.getRecentPuzzles, { limit: 8 });

  return (
    <section className="px-4 py-20">
      <div className="container mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-semibold">Recent Puzzles</h2>
          <Button asChild variant="outline">
            <Link href="/puzzles">View all</Link>
          </Button>
        </div>
        <PuzzleViewProvider viewMode="grid">
          {recentPuzzles?.map((p) => (
            <ProductCard key={p._id} puzzle={p} />
          ))}
        </PuzzleViewProvider>
      </div>
    </section>
  );
}
