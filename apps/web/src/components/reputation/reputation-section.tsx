"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { gateway } from "@/gateway";
import type { Id } from "@/gateway";
import { useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import { StarInput } from "./star-input";

// A member's public reputation on their profile: a summary (avg stars, count, credibility hint)
// plus the reviews they have RECEIVED, newest first, each with reviewer, overall + sub-scores,
// and an optional comment. Both reads are auth-gated queries keyed by the member's user id.
interface ReputationSectionProps {
  memberId: Id<"users"> | undefined;
}

// Map the 0-1 credibility curve onto a coarse, friendly trust hint.
function credibilityKey(credibility: number): "low" | "medium" | "high" {
  if (credibility >= 0.66) return "high";
  if (credibility >= 0.33) return "medium";
  return "low";
}

export function ReputationSection({ memberId }: ReputationSectionProps) {
  const t = useTranslations("reputation");

  const profile = useQuery(
    gateway.reputation.profile,
    memberId ? { memberId } : "skip",
  );
  const reviews = useQuery(
    gateway.reputation.reviewsForMember,
    memberId ? { memberId } : "skip",
  );

  if (profile === undefined || reviews === undefined) {
    return null;
  }

  const subScoreKeys = [
    "communication",
    "packaging",
    "condition",
    "timeliness",
  ] as const;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("subtitle")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Summary */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="flex items-center gap-2">
            <span className="text-3xl font-bold text-yellow-600">
              {profile.averageRating.toFixed(1)}
            </span>
            <StarInput value={Math.round(profile.averageRating)} size="sm" />
          </div>
          <div className="text-sm text-muted-foreground">
            {t("reviewCount", { count: profile.reviewCount })}
          </div>
          {profile.reviewCount > 0 && (
            <div className="text-sm text-muted-foreground">
              {t("credibility")}:{" "}
              <span className="font-medium text-foreground">
                {t(`credibilityLevel.${credibilityKey(profile.credibility)}`)}
              </span>
            </div>
          )}
        </div>

        {/* Received reviews */}
        {reviews.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noReviewsYet")}</p>
        ) : (
          <ul className="space-y-4">
            {reviews.map((review) => (
              <li
                key={review._id}
                className="rounded-lg border bg-muted/30 p-4 space-y-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <StarInput value={review.rating} size="sm" />
                  <span className="text-xs text-muted-foreground">
                    {new Date(review.createdAt).toLocaleDateString()}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  {subScoreKeys.map((key) => (
                    <div
                      key={key}
                      className="flex items-center justify-between gap-2"
                    >
                      <span className="text-muted-foreground">
                        {t(`scores.${key}`)}
                      </span>
                      <StarInput value={review.categories[key]} size="sm" />
                    </div>
                  ))}
                </div>

                {review.comment && (
                  <p className="text-sm text-foreground">{review.comment}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
