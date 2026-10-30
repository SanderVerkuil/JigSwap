"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { gateway } from "@/gateway";
import { cn } from "@/lib/utils";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useId } from "react";
import { useFormatter, useTranslations } from "use-intl";
import type { Member } from "./member-view";

// The trust level is completed exchanges only (reviews don't count): 5 reach
// Intermediate, 10 reach Experienced, the top of the meter.
const TRUST_INTERMEDIATE = 5;
const TRUST_MAX = 10;
type TrustLevelKey = "beginner" | "intermediate" | "experienced";

// Map completed exchanges onto the coarse trust levels the old profile used.
function trustLevelKey(tradesCompleted: number): TrustLevelKey {
  if (tradesCompleted >= TRUST_MAX) return "experienced";
  if (tradesCompleted >= TRUST_INTERMEDIATE) return "intermediate";
  return "beginner";
}

// The next level up and how many more completed exchanges reach it; null at
// the top level.
function nextTrustLevel(
  tradesCompleted: number,
): { key: TrustLevelKey; remaining: number } | null {
  if (tradesCompleted >= TRUST_MAX) return null;
  if (tradesCompleted >= TRUST_INTERMEDIATE) {
    return { key: "experienced", remaining: TRUST_MAX - tradesCompleted };
  }
  return {
    key: "intermediate",
    remaining: TRUST_INTERMEDIATE - tradesCompleted,
  };
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
  const trustLabelId = useId();
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
  const trustValue = Math.min(stats.swaps, TRUST_MAX);
  const next = nextTrustLevel(stats.swaps);

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
            <div className="font-heading text-primary-text text-4xl leading-none font-bold">
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
          <span id={trustLabelId}>{t("trustLevel")}</span>:{" "}
          <span className="text-primary-text">
            {t(`trustLevels.${trustKey}`)}
          </span>
        </div>
        <div
          role="progressbar"
          aria-labelledby={trustLabelId}
          aria-valuemin={0}
          aria-valuemax={TRUST_MAX}
          aria-valuenow={trustValue}
          aria-valuetext={t("trustLevelValueText", {
            level: t(`trustLevels.${trustKey}`),
            count: stats.swaps,
          })}
          className="bg-muted mt-2 h-1.5 w-full overflow-hidden rounded-full"
        >
          <div
            className="bg-jigsaw-primary h-full rounded-full transition-all duration-300"
            style={{ width: `${(trustValue / TRUST_MAX) * 100}%` }}
          />
        </div>
        <p className="text-muted-foreground mt-2 text-xs">
          {next
            ? t("trustLevelDescriptionNext", {
                count: next.remaining,
                level: t(`trustLevels.${next.key}`),
              })
            : t("trustLevelDescription")}
        </p>
      </div>
    </section>
  );
}
