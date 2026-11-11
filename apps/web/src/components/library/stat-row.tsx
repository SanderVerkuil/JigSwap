import { cn } from "@/lib/utils";

export interface StatRowItem {
  label: string;
  value: string;
  sub?: string;
}

// Open divided stat row from the design language: big numbers separated
// by thin hairline rules, no boxes. Two columns on mobile (three with
// mobileCols={3}, for rows of short secondary figures), one flexible column
// per stat from the md breakpoint up.
export function StatRow({
  stats,
  size = "lg",
  mobileCols = 2,
  className,
}: {
  stats: StatRowItem[];
  size?: "lg" | "md";
  mobileCols?: 2 | 3;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid gap-y-6 md:flex",
        mobileCols === 3 ? "grid-cols-3" : "grid-cols-2",
        className,
      )}
    >
      {stats.map((stat, i) => {
        const startsMobileRow = i % mobileCols === 0;
        return (
          <div
            key={stat.label}
            className={cn(
              "flex min-w-0 flex-col gap-1.5 md:flex-1",
              // Hairline dividers: between the mobile columns, and between
              // every stat once the row lays out horizontally. Three phone
              // columns get a narrower gutter so their labels keep room.
              !startsMobileRow &&
                (mobileCols === 3 ? "border-l pl-4 md:pl-6" : "border-l pl-6"),
              i > 0 && startsMobileRow && "md:border-l md:pl-6",
            )}
          >
            <span
              className={cn(
                "font-sans leading-none font-semibold tabular-nums",
                size === "lg" ? "text-4xl" : "text-2xl",
              )}
            >
              {stat.value}
            </span>
            <span className="text-muted-foreground text-sm">{stat.label}</span>
            {stat.sub && (
              <span className="text-muted-foreground text-xs">{stat.sub}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
