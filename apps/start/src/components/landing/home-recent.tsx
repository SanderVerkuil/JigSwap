"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Image } from "@/compat/image";
import { Link } from "@/compat/link";
import { gateway } from "@/gateway";
import { useQuery } from "convex/react";

// Next imported the dashboard PuzzleCard via next/dynamic({ ssr: false }); that
// card lives under the (dashboard) puzzles leaf and is typed for owned-copy rows.
// The owned-copy card is part of the dashboard wave (part 2), so this rail renders
// the lighter catalog-summary shape (catalog.recentPuzzles) inline instead.
export function HomeRecent() {
  const recentPuzzles = useQuery(gateway.catalog.recentPuzzles, { limit: 8 });

  return (
    <section className="px-4 py-20">
      <div className="container mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-semibold">Recent Puzzles</h2>
          <Button asChild variant="outline">
            <Link href="/puzzles">View all</Link>
          </Button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {recentPuzzles?.map((puzzle) => (
            <Card key={puzzle._id} className="overflow-hidden">
              {puzzle.image ? (
                <div className="relative aspect-video w-full overflow-hidden bg-muted">
                  <Image
                    src={puzzle.image}
                    alt={puzzle.title}
                    fill
                    sizes="(max-width: 768px) 100vw, 25vw"
                  />
                </div>
              ) : null}
              <CardHeader>
                <CardTitle className="line-clamp-1 text-base">
                  {puzzle.title}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {puzzle.brand ? `${puzzle.brand} • ` : ""}
                {puzzle.pieceCount} pieces
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
