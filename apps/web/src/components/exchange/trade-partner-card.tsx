"use client";

import { Card } from "@/components/ui/card";
import { StarRating } from "@/components/ui/star-rating";
import { gateway, type Id } from "@/gateway";
import { useMemberDisplayName } from "@/lib/member-display-name";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Mail, Star } from "lucide-react";
import { useFormatter, useTranslations } from "use-intl";

interface TradePartnerCardProps {
  exchangeId: string;
  /** The localized "From" / "To" lead-in. */
  label: string;
  /** Only the requester can face a hidden partner (the owner always sees the requester). */
  viewerIsRequester: boolean;
}

// The counterparty of ONE exchange, as `exchange.tradePartner` discloses it: a revealed partner's
// trade card (name, handle, email when allowed, reviews received), else the generic or
// former-member label. Their normal profile is linked only when it is viewable by the usual rules.
export function TradePartnerCard({
  exchangeId,
  label,
  viewerIsRequester,
}: TradePartnerCardProps) {
  const t = useTranslations("trades.partner");
  const tReputation = useTranslations("reputation");
  const tRich = useTranslations("notifications.rich");
  const displayName = useMemberDisplayName();
  const format = useFormatter();
  const { data: partner } = useQuery(
    convexQuery(gateway.exchange.tradePartner, {
      exchangeId: exchangeId as Id<"exchanges">,
    }),
  );

  if (partner === undefined) {
    return <div className="bg-muted h-16 animate-pulse rounded-xl" />;
  }
  if (partner === null) return null;

  const name =
    partner.state === "departed"
      ? tRich("deletedMember")
      : // Never resolve the name from the email: it is shown separately, only when allowed.
        displayName(
          partner.state === "revealed"
            ? { name: partner.name, username: partner.username }
            : null,
        );

  return (
    <Card className="gap-3 px-4 py-4">
      <div className="min-w-0">
        <p className="text-muted-foreground text-xs">{label}</p>
        {partner.state === "revealed" && partner.profileViewable ? (
          <Link
            to="/members/$handle"
            params={{ handle: partner.username ?? partner.memberId }}
            className="font-semibold hover:underline"
          >
            {name}
          </Link>
        ) : (
          <p className="font-semibold">{name}</p>
        )}
        {partner.state === "hidden" && viewerIsRequester && (
          <p className="text-muted-foreground mt-1 text-sm">
            {t("hiddenNote")}
          </p>
        )}
        {partner.state === "revealed" && (
          <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            {partner.username && <span>@{partner.username}</span>}
            {partner.email && (
              <a
                href={`mailto:${partner.email}`}
                className="inline-flex items-center gap-1 hover:underline"
              >
                <Mail className="h-3.5 w-3.5" aria-hidden />
                {partner.email}
              </a>
            )}
          </div>
        )}
      </div>

      {partner.state === "revealed" && (
        <div className="space-y-2">
          <p className="flex items-center gap-1.5 text-sm">
            <span className="font-medium">{t("reviewsHeading")}</span>
            {partner.reviews.totalReviews === 0 ? (
              <span className="text-muted-foreground">
                {tReputation("noReviewsYet")}
              </span>
            ) : (
              <span
                className="text-muted-foreground inline-flex items-center gap-1"
                title={tReputation("averageRating")}
              >
                <Star
                  className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400"
                  aria-hidden
                />
                <span className="text-foreground font-medium">
                  {partner.reviews.averageRating.toFixed(1)}
                </span>
                <span>
                  (
                  {tReputation("reviewCount", {
                    count: partner.reviews.totalReviews,
                  })}
                  )
                </span>
              </span>
            )}
          </p>
          {partner.reviews.items.length > 0 && (
            <ul className="space-y-2">
              {partner.reviews.items.map((review, index) => (
                <li
                  key={`${review.createdAt}-${index}`}
                  className="bg-muted/50 rounded-lg p-2.5 text-sm"
                >
                  <StarRating value={review.rating} size="sm" />
                  {review.comment && <p className="mt-1">{review.comment}</p>}
                  <p className="text-muted-foreground mt-1 text-xs">
                    {displayName({ name: review.reviewerName })} ·{" "}
                    {format.dateTime(new Date(review.createdAt), {
                      dateStyle: "medium",
                    })}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}
