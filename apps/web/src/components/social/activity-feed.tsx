"use client";

import { EmptyState } from "@/components/community/primitives";
import { Skeleton } from "@/components/ui/skeleton";
import { gateway } from "@/gateway";
import { cn } from "@/lib/utils";
import { useQuery } from "convex/react";
import { formatDistanceToNow } from "date-fns";
import type { LucideIcon } from "lucide-react";
import { ArrowRightLeft, CircleCheck, Package } from "lucide-react";

// The acting member's activity feed: their own activity plus everyone they follow, newest-first.
// Scoping + the foreign-event mapping happen server-side; here we only render the ActivityEntryView
// as open, thin-divider rows on the ground (no boxed card).
type ActivityKind = "completion" | "acquisition" | "exchange";

const META: Record<
  ActivityKind,
  { icon: LucideIcon; label: string; accent: string }
> = {
  completion: {
    icon: CircleCheck,
    label: "completed a puzzle",
    accent: "text-green-500",
  },
  acquisition: {
    icon: Package,
    label: "added a puzzle",
    accent: "text-blue-500",
  },
  exchange: {
    icon: ArrowRightLeft,
    label: "settled an exchange",
    accent: "text-amber-500",
  },
};

export function ActivityFeed() {
  const feed = useQuery(gateway.social.activityFeed, {});

  if (feed === undefined) {
    return (
      <div className="flex flex-col gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (feed.length === 0) {
    return (
      <EmptyState
        title="No recent activity yet"
        sub="Follow other members to see what they are up to."
      />
    );
  }

  return (
    <div className="flex flex-col">
      {feed.map((entry, index) => {
        const meta = META[entry.kind as ActivityKind];
        const Icon = meta.icon;
        return (
          <div
            key={`${entry.ref}-${entry.memberId}-${entry.occurredAt}`}
            className={cn(
              "flex items-start gap-3 py-3.5",
              index < feed.length - 1 && "border-b",
            )}
          >
            <span className="bg-muted mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full">
              <Icon className={`h-4 w-4 ${meta.accent}`} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">A member {meta.label}</p>
              <p className="text-muted-foreground text-xs">
                {formatDistanceToNow(new Date(entry.occurredAt), {
                  addSuffix: true,
                })}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
