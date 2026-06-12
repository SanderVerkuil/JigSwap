import { cn } from "@/lib/utils";

export interface StatRowItem {
  label: string;
  value: string;
  sub?: string;
}

// Open divided stat row from the design language: big Baloo numbers separated
// by thin hairline rules, no boxes. Two columns on mobile, one flexible column
// per stat from the md breakpoint up.
export function StatRow({
  stats,
  size = "lg",
  className,
}: {
  stats: StatRowItem[];
  size?: "lg" | "md";
  className?: string;
}) {
  return (
    <div className={cn("grid grid-cols-2 gap-y-6 md:flex", className)}>
      {stats.map((stat, i) => (
        <div
          key={stat.label}
          className={cn(
            "flex min-w-0 flex-col gap-1.5 md:flex-1",
            // Hairline dividers: between the two mobile columns, and between
            // every stat once the row lays out horizontally.
            i % 2 === 1 && "border-l pl-6",
            i > 0 && i % 2 === 0 && "md:border-l md:pl-6",
          )}
        >
          <span
            className={cn(
              "font-heading leading-none font-bold",
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
      ))}
    </div>
  );
}
