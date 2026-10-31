"use client";

import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { StarRating } from "@/components/ui/star-rating";
import { Switch } from "@/components/ui/switch";
import { gateway, type Id } from "@/gateway";
import { useMemberDisplayName } from "@/lib/member-display-name";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Mail, Star } from "lucide-react";
import { useId } from "react";
import { toast } from "sonner";
import { useFormatter, useTranslations } from "use-intl";

interface TradePartnerCardProps {
  exchangeId: string;
  /** The localized "From" / "To" lead-in. */
  label: string;
  /** Only the requester can face a hidden partner (the owner always sees the requester). */
  viewerIsRequester: boolean;
}

// The counterparty of ONE exchange, as `exchange.tradePartner` discloses it: a revealed partner's
// trade card (name, handle, their email once THEY chose to share it, reviews received), else the
// generic or former-member label. Their normal profile is linked only when it is viewable by the
// usual rules. Once sharing is open (accepted, completed, disputed) the viewer gets their own
// "Share my email" switch: an email is never shown without its owner's choice.
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
  const shareSwitchId = useId();
  const { data: partner } = useQuery(
    convexQuery(gateway.exchange.tradePartner, {
      exchangeId: exchangeId as Id<"exchanges">,
    }),
  );
  const setSharing = useMutation({
    mutationFn: useConvexMutation(gateway.exchange.setContactSharing),
    onError: () => toast.error(t("shareEmailError")),
  });

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
            // The id, never the username (SEC-07); the route redirects to the canonical handle.
            params={{ handle: partner.memberId }}
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
            {/* The canonical handle, only when it reads as a name (not the bare id). Never the
                username: another member may hold it as a slug (SEC-07). A backend that predates
                `handle` (deploy skew) leaves it out. */}
            {partner.handle && partner.handle !== partner.memberId && (
              <span>@{partner.handle}</span>
            )}
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

      {/* `?.`: skew-safe while a web deploy runs ahead of the Convex one (no emailSharing yet). */}
      {partner.state === "revealed" && partner.emailSharing?.open && (
        <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
          <div className="min-w-0 space-y-0.5">
            <Label htmlFor={shareSwitchId} className="leading-snug">
              {t("shareEmail", { name })}
            </Label>
            <p className="text-muted-foreground text-xs">
              {t("shareEmailHint")}
            </p>
          </div>
          <Switch
            id={shareSwitchId}
            checked={
              setSharing.isPending
                ? setSharing.variables.share
                : partner.emailSharing.youShare
            }
            disabled={setSharing.isPending}
            onCheckedChange={(share) =>
              setSharing.mutate({
                exchangeId: exchangeId as Id<"exchanges">,
                share,
              })
            }
          />
        </div>
      )}

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
                  {format.number(partner.reviews.averageRating, {
                    minimumFractionDigits: 1,
                    maximumFractionDigits: 1,
                  })}
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
                    {review.reviewerDeparted
                      ? tRich("deletedMember")
                      : displayName({ name: review.reviewerName })}{" "}
                    ·{" "}
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
