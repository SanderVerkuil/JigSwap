"use client";

import { EmptyState } from "@/components/community/primitives";
import { Skeleton } from "@/components/ui/skeleton";
import { gateway } from "@/gateway";
import { useRelativeTime } from "@/hooks/use-relative-time";
import { useMemberDisplayName } from "@/lib/member-display-name";
import { cn } from "@/lib/utils";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "use-intl";
import { ActivityBatchCovers } from "./activity-batch-covers";
import { ACTIVITY_META, isKnownActivityKind } from "./activity-feed-meta";
import { ActivityTargetLink, ActorLink } from "./activity-links";

// The acting member's activity feed: their own activity plus everyone they follow, newest-first.
// Scoping + the foreign-event mapping happen server-side; here we only render the ActivityEntryView
// as open, thin-divider rows on the ground (no boxed card). A row with a server-decided target is one
// stretched link to it; the actor's name is a separate sibling link to their profile.

export function ActivityFeed() {
  const t = useTranslations("activity");
  const displayName = useMemberDisplayName();
  const relativeTime = useRelativeTime();
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
        if (!isKnownActivityKind(entry.kind)) return null;
        const meta = ACTIVITY_META[entry.kind];
        const Icon = meta.icon;
        const isYou = me != null && entry.memberId === me._id;
        // A grouped batch add reads "added N puzzles"; the other kinds ignore the count.
        const count = entry.batch?.count ?? 1;
        const name = displayName({ name: entry.actorName });
        return (
          <div
            key={`${entry.ref}-${entry.memberId}-${entry.occurredAt}`}
            className={cn(
              "relative flex items-start gap-3 py-3.5",
              entry.target && "hover:bg-muted/40 transition-colors",
              index < feed.length - 1 && "border-b",
            )}
          >
            <span className="bg-muted mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full">
              <Icon className={`h-4 w-4 ${meta.accent}`} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">
                {isYou
                  ? t(`${entry.kind}.you`, { count })
                  : t.rich(`${entry.kind}.other`, {
                      name,
                      count,
                      strong: (chunks) =>
                        entry.actor ? (
                          <ActorLink actor={entry.actor} className="py-3">
                            <strong>{chunks}</strong>
                          </ActorLink>
                        ) : (
                          <strong>{chunks}</strong>
                        ),
                    })}
              </p>
              {entry.batch && <ActivityBatchCovers batch={entry.batch} />}
              <p className="text-muted-foreground text-xs">
                {relativeTime(new Date(entry.occurredAt))}
              </p>
            </div>
            {entry.target && (
              <ActivityTargetLink target={entry.target} count={count} />
            )}
          </div>
        );
      })}
    </div>
  );
}
