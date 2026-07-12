"use client";

import { EmptyState } from "@/components/community/primitives";
import { Skeleton } from "@/components/ui/skeleton";
import { gateway } from "@/gateway";
import { cn } from "@/lib/utils";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import { ArrowRightLeft, CircleCheck, Package } from "lucide-react";
import { useFormatter, useTranslations } from "use-intl";

// The acting member's activity feed: their own activity plus everyone they follow, newest-first.
// Scoping + the foreign-event mapping happen server-side; here we only render the ActivityEntryView
// as open, thin-divider rows on the ground (no boxed card).
type ActivityKind = "completion" | "acquisition" | "exchange";

// Icon + accent per kind; the human-readable label is translated at render time
// (key `activity.<kind>`), and the timestamp uses the locale-aware formatter.
const META: Record<ActivityKind, { icon: LucideIcon; accent: string }> = {
  completion: { icon: CircleCheck, accent: "text-green-500" },
  acquisition: { icon: Package, accent: "text-blue-500" },
  exchange: { icon: ArrowRightLeft, accent: "text-amber-500" },
};

export function ActivityFeed() {
  const t = useTranslations("activity");
  const format = useFormatter();
  const { data: feed } = useQuery(convexQuery(gateway.social.activityFeed, {}));
  const { data: me } = useQuery(convexQuery(gateway.identity.currentUser, {}));

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
    return <EmptyState title={t("empty")} sub={t("emptyHint")} />;
  }

  return (
    <div className="flex flex-col">
      {feed.map((entry, index) => {
        const meta = META[entry.kind as ActivityKind];
        const Icon = meta.icon;
        const isYou = me != null && entry.memberId === me._id;
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
              <p className="text-sm font-medium">
                {isYou
                  ? t(`${entry.kind}.you`)
                  : t.rich(`${entry.kind}.other`, {
                      name: entry.actorName,
                      strong: (chunks) => <strong>{chunks}</strong>,
                    })}
              </p>
              <p className="text-muted-foreground text-xs">
                {format.relativeTime(new Date(entry.occurredAt))}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
