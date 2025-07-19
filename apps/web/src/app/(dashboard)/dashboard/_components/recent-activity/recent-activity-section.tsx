"use client";

import { RecentPuzzlesCard } from "./recent-puzzles-card";
import { RecentTradesCard } from "./recent-trades-card";

export function RecentActivitySection() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <RecentPuzzlesCard />
      <RecentTradesCard />
    </div>
  );
}
