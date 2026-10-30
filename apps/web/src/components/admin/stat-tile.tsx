"use client";

// Small numeric stat card shared by the admin detail pages
// (/admin/users/$userId and /admin/puzzles/$puzzleId stat grids). `atLeast` marks a count that
// stopped at a cap: it reads "1000+".

export function StatTile({
  label,
  value,
  atLeast = false,
}: {
  label: string;
  value: number;
  atLeast?: boolean;
}) {
  return (
    <div className="rounded-xl border bg-card px-4 py-3">
      <div className="text-2xl font-semibold tabular-nums">
        {value}
        {atLeast && "+"}
      </div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
