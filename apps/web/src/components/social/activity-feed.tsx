"use client";

import { Card, CardContent } from "@/components/ui/card";
import { gateway } from "@/gateway";
import { useQuery } from "convex/react";
import { formatDistanceToNow } from "date-fns";
import { ArrowRightLeft, CircleCheck, Package } from "lucide-react";
import type { LucideIcon } from "lucide-react";

// The acting member's activity feed: their own activity plus everyone they follow, newest-first.
// Scoping + the foreign-event mapping happen server-side; here we only render the ActivityEntryView.
type ActivityKind = "completion" | "acquisition" | "exchange";

const META: Record<ActivityKind, { icon: LucideIcon; label: string; accent: string }> = {
  completion: { icon: CircleCheck, label: "completed a puzzle", accent: "text-green-500" },
  acquisition: { icon: Package, label: "added a puzzle", accent: "text-blue-500" },
  exchange: { icon: ArrowRightLeft, label: "settled an exchange", accent: "text-amber-500" },
};

export function ActivityFeed() {
  const feed = useQuery(gateway.social.activityFeed, {});

  if (feed === undefined) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          Loading activity...
        </CardContent>
      </Card>
    );
  }

  if (feed.length === 0) {
    return (
      <Card>
        <CardContent className="p-12 text-center text-sm text-muted-foreground">
          No recent activity yet. Follow other members to see what they are up to.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden p-0">
      <ul className="divide-y">
        {feed.map((entry) => {
          const meta = META[entry.kind as ActivityKind];
          const Icon = meta.icon;
          return (
            <li
              key={`${entry.ref}-${entry.memberId}-${entry.occurredAt}`}
              className="flex items-start gap-3 px-4 py-4"
            >
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
                <Icon className={`h-4 w-4 ${meta.accent}`} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">A member {meta.label}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(entry.occurredAt), {
                    addSuffix: true,
                  })}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
