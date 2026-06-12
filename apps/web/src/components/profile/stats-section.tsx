"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { gateway, Id } from "@/gateway";
import { cn } from "@/lib/utils";
import { useQuery } from "convex/react";
import { useTranslations } from "use-intl";
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
// page ground (no stat cards). The old trust-level meter survives below as a
// slim centered strip.
export function ProfileStatsSection({ member }: { member: Member }) {
  const t = useTranslations("profile");
  const stats = useQuery(gateway.identity.userStats, {
    userId: member._id as Id<"users">,
  });

  if (stats === undefined) {
    return (
      <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  const items = [
    { value: stats.puzzlesOwned, label: t("puzzlesOwned") },
    { value: stats.tradesCompleted, label: t("completedExchanges") },
    {
      value: stats.averageRating > 0 ? stats.averageRating.toFixed(1) : "—",
      label: t("averageRating"),
    },
    { value: stats.puzzlesAvailable, label: t("availablePuzzles") },
  ];

  const trustKey = trustLevelKey(stats.tradesCompleted);
  const trustProgress = Math.min((stats.tradesCompleted / 10) * 100, 100);

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
              {item.value}
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
