"use client";

import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { usePuzzleView } from "./puzzle-view-provider";

// Placeholder for a catalogue card while results load. It keeps the real card's footprint (square
// cover plus a ~180px text and action block) so the grid doesn't jump when the cards arrive.
export function PuzzleCardSkeleton() {
  const { viewMode } = usePuzzleView();
  if (viewMode === "list") {
    return (
      <Card
        aria-hidden="true"
        data-testid="puzzle-card-skeleton"
        className="flex-row items-center gap-3 overflow-hidden p-2 sm:gap-4"
      >
        <Skeleton className="size-14 shrink-0 rounded-md sm:size-12" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      </Card>
    );
  }
  const text = (
    <div className="flex h-[180px] flex-1 flex-col gap-2 p-4">
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-3 w-1/3" />
      <div className="flex gap-2">
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-5 w-16" />
      </div>
      <Skeleton className="h-5 w-24" />
      <Skeleton className="mt-auto h-9 w-full" />
    </div>
  );
  return (
    <Card
      aria-hidden="true"
      data-testid="puzzle-card-skeleton"
      className="gap-0 overflow-hidden p-0"
    >
      <Skeleton className="aspect-square w-full rounded-none" />
      {text}
    </Card>
  );
}
