"use client";

import type { Id } from "@/gateway";
import { gateway } from "@/gateway";
import { cn } from "@/lib/utils";
import { useQuery } from "convex/react";
import { Star } from "lucide-react";
import { useTranslations } from "use-intl";

// A compact, droppable trust signal (avg stars + review count) shown next to a member's name.
// Self-fetches its own reputation profile so callers only need to pass a memberId; renders
// nothing until loaded and a muted "no reviews yet" hint when the member has none.
interface ReputationBadgeProps {
  memberId: Id<"users"> | undefined;
  className?: string;
}

export function ReputationBadge({ memberId, className }: ReputationBadgeProps) {
  const t = useTranslations("reputation");
  const profile = useQuery(
    gateway.reputation.profile,
    memberId ? { memberId } : "skip",
  );

  if (profile === undefined) return null;

  if (profile.reviewCount === 0) {
    return (
      <span className={cn("text-xs text-muted-foreground", className)}>
        {t("noReviewsYet")}
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs text-muted-foreground",
        className,
      )}
      title={t("averageRating")}
    >
      <Star className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400" />
      <span className="font-medium text-foreground">
        {profile.averageRating.toFixed(1)}
      </span>
      <span>({profile.reviewCount})</span>
    </span>
  );
}
