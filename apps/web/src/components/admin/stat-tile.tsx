"use client";

// Small numeric stat card shared by the admin detail pages
// (/admin/users/$userId and /admin/puzzles/$puzzleId stat grids).

export function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border bg-card px-4 py-3">
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
