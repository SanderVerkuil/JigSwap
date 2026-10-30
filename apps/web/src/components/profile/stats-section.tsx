"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { gateway } from "@/gateway";
import { cn } from "@/lib/utils";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useFormatter, useTranslations } from "use-intl";
import type { Member } from "./member-view";

// Map completed trades onto the coarse trust levels the old profile used.
function trustLevelKey(
  tradesCompleted: number,
): "beginner" | "intermediate" | "experienced" {
  if (tradesCompleted >= 10) return "experienced";
  if (tradesCompleted >= 5) return "intermediate";
  return "beginner";
}

// The profile's key numbers as four centered, hairline-divided columns — big
// font-heading figures in the brand primary over muted labels, straight on the
// page ground (no stat cards). They are the same four numbers, from the same
// read and with the same labels, that visitors see on /members/<handle>, so
// the owner's /profile never disagrees with their public page. The old
// trust-level meter survives below as a slim centered strip.
export function ProfileStatsSection({ member }: { member: Member }) {
  const t = useTranslations("profile");
  const tStats = useTranslations("members.profile");
  const format = useFormatter();
  // By id, never by slug/username: the id is the one handle that can only
  // resolve to this member. The member's own profile is always unlocked.
  const { data: profile } = useQuery(
    convexQuery(gateway.social.publicProfile, { handle: member._id }),
  );

  if (profile === undefined) {
    return (
      <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }
  // Not found or locked can't happen for the member themself; degrade to no
  // stats rather than crash if it ever does.
  if (profile === null || profile.locked) {
    return null;
  }

  const { stats } = profile;
  const items = [
    { value: stats.puzzlesOwned, label: tStats("statOwned") },
    { value: stats.completions, label: tStats("statCompletions") },
    { value: stats.piecesPlaced, label: tStats("statPieces") },
    { value: stats.swaps, label: tStats("statSwaps") },
  ];

  // Swaps are completed exchanges (tradesCompleted server-side).
  const trustKey = trustLevelKey(stats.swaps);
  const trustProgress = Math.min((stats.swaps / 10) * 100, 100);

  return (
    <section className="flex flex-col gap-10">
      <div className="grid grid-cols-2 gap-y-8 sm:grid-cols-4">
        {items.map((item, i) => (
          <div
            key={item.label}
            className={cn(
              "px-3 text-center",
              i % 2 === 1 && "border-l",
              i === 2 && "sm:border-l",
            )}
          >
            <div className="font-heading text-jigsaw-primary text-4xl leading-none font-bold">
              {format.number(item.value)}
            </div>
            <div className="text-muted-foreground mt-2 text-sm">
              {item.label}
            </div>
          </div>
        ))}
      </div>

      {/* Trust level: a slim, centered meter — same thresholds as before. */}
      <div className="mx-auto w-full max-w-sm text-center">
        <div className="text-sm font-semibold">
          {t("trustLevel")}:{" "}
          <span className="text-jigsaw-primary">
            {t(`trustLevels.${trustKey}`)}
          </span>
        </div>
        <div className="bg-muted mt-2 h-1.5 w-full overflow-hidden rounded-full">
          <div
            className="bg-jigsaw-primary h-full rounded-full transition-all duration-300"
            style={{ width: `${trustProgress}%` }}
          />
        </div>
        <p className="text-muted-foreground mt-2 text-xs">
          {t("trustLevelDescription")}
        </p>
      </div>
    </section>
  );
}
