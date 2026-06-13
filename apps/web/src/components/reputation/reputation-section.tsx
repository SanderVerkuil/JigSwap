"use client";

import { SectionHead } from "@/components/dashboard-home/section-head";
import { StarRating } from "@/components/ui/star-rating";
import type { Id } from "@/gateway";
import { gateway } from "@/gateway";
import { useQuery } from "convex/react";
import { ShieldCheck } from "lucide-react";
import { useTranslations } from "use-intl";

// A member's public reputation on their profile: a summary line (avg stars,
// count, credibility hint) plus the reviews they have RECEIVED, newest first,
// each with overall + sub-scores and an optional comment. Open, card-free
// layout: a SectionHead over plain rows separated by hairline rules. Both
// reads are auth-gated queries keyed by the member's user id.
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
    <section>
      <SectionHead
        title={t("title")}
        icon={ShieldCheck}
        meta={t("reviewCount", { count: profile.reviewCount })}
      />

      {/* Summary */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex items-center gap-2">
          <span className="font-heading text-3xl leading-none font-bold">
            {profile.averageRating.toFixed(1)}
          </span>
          <StarRating value={Math.round(profile.averageRating)} size="sm" />
        </div>
        {profile.reviewCount > 0 && (
          <div className="text-muted-foreground text-sm">
            {t("credibility")}:{" "}
            <span className="text-foreground font-medium">
              {t(`credibilityLevel.${credibilityKey(profile.credibility)}`)}
            </span>
          </div>
        )}
      </div>

      {/* Received reviews */}
      {reviews.length === 0 ? (
        <p className="text-muted-foreground mt-6 text-sm">
          {t("noReviewsYet")}
        </p>
      ) : (
        <ul className="mt-4 divide-y">
          {reviews.map((review) => (
            <li key={review._id} className="space-y-3 py-4">
              <div className="flex items-center justify-between gap-2">
                <StarRating value={review.rating} size="sm" />
                <span className="text-muted-foreground text-xs">
                  {new Date(review.createdAt).toLocaleDateString()}
                </span>
              </div>

              <div className="grid max-w-xl grid-cols-2 gap-x-8 gap-y-1 text-xs">
                {subScoreKeys.map((key) => (
                  <div
                    key={key}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="text-muted-foreground">
                      {t(`scores.${key}`)}
                    </span>
                    <StarRating value={review.categories[key]} size="sm" />
                  </div>
                ))}
              </div>

              {review.comment && (
                <p className="text-foreground text-sm">{review.comment}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
