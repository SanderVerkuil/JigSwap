"use client";

// A community member as a self-contained tile (one of the sanctioned card
// uses), in two rows: identity (avatar, a name that wraps to two lines, and a
// meta line with the "Follows you" badge and location) above a hairline, then
// the owned/swaps/rating stats beside compact icon actions (follow toggle +
// connection-gated Message). Data comes from the existing identity reads
// (getUserById + getUserStats). The whole card links to the profile through a
// stretched link on the name (::after overlay); the actions sit above it
// (relative z-10), so no interactive element is nested in another.
// Design: docs/superpowers/specs/2026-10-17-network-card-redesign-design.md
import { MemberInitial } from "@/components/members/member-initial";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { gateway, Id } from "@/gateway";
import { useMemberDisplayName } from "@/lib/member-display-name";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { MapPin, Star } from "lucide-react";
import { useId } from "react";
import { useFormatter, useTranslations } from "use-intl";
import { FollowButton } from "./follow-button";
import { ratingView } from "./member-stats";
import { MessageButton } from "./message-button";

export function MemberTileSkeleton() {
  return (
    <Card className="gap-3 p-3.5">
      <div className="flex items-start gap-3">
        <Skeleton className="size-12 shrink-0 rounded-full" />
        <div className="flex-1 space-y-2 pt-1">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 border-t pt-3">
        <Skeleton className="h-3 w-28" />
        <div className="flex gap-1.5">
          <Skeleton className="size-9 rounded-md" />
          <Skeleton className="size-9 rounded-md" />
        </div>
      </div>
    </Card>
  );
}

export function MemberTile({
  memberId,
  followsYou,
  hideLocation = false,
}: {
  memberId: Id<"users">;
  followsYou: boolean;
  // Discovery surfaces (Find people) omit the location line: stats build trust with
  // strangers, street-level context doesn't. Defaults off so network tiles are unchanged.
  hideLocation?: boolean;
}) {
  const t = useTranslations("people");
  const tReputation = useTranslations("reputation");
  const format = useFormatter();
  const displayName = useMemberDisplayName();
  const id = useId();
  const { data: member } = useQuery(
    convexQuery(gateway.identity.byId, { userId: memberId }),
  );
  const { data: stats } = useQuery(
    convexQuery(gateway.identity.userStats, { userId: memberId }),
  );

  if (member === undefined) {
    return <MemberTileSkeleton />;
  }
  if (member === null) {
    return null;
  }

  const name = displayName(member);
  const location = hideLocation ? undefined : member.location;
  const hasMeta = followsYou || !!location;
  const metaId = `${id}-meta`;
  const statsId = `${id}-stats`;
  const describedBy =
    [hasMeta && metaId, stats && statsId].filter(Boolean).join(" ") ||
    undefined;
  const view = stats ? ratingView(stats) : undefined;
  const rating =
    view?.kind === "rated"
      ? {
          ...view,
          // Locale-aware: "4,8" in nl, "4.8" in en.
          formatted: format.number(view.value, {
            minimumFractionDigits: 1,
            maximumFractionDigits: 1,
          }),
        }
      : undefined;

  return (
    <Card className="group relative gap-3 p-3.5 transition-colors has-[[data-card-link]:hover]:bg-accent/40">
      <div className="flex items-start gap-3">
        <Avatar className="size-12 shrink-0" aria-hidden="true">
          {member.avatar && <AvatarImage src={member.avatar} alt="" />}
          <AvatarFallback className="text-sm font-semibold">
            <MemberInitial source={member} />
          </AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1">
          <h3 className="text-base leading-snug font-semibold">
            <Link
              to="/members/$handle"
              params={{ handle: member.username ?? member._id }}
              data-card-link=""
              title={name}
              aria-describedby={describedBy}
              className="line-clamp-2 rounded-sm [overflow-wrap:anywhere] after:absolute after:inset-0 after:z-[1] after:rounded-xl after:content-[''] hover:underline focus-visible:outline-none focus-visible:after:ring-[3px] focus-visible:after:ring-ring/50"
            >
              {name}
            </Link>
          </h3>
          {hasMeta && (
            <div
              id={metaId}
              className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"
            >
              {followsYou && (
                <Badge variant="secondary">{t("followsYou")}</Badge>
              )}
              {location && (
                <span className="flex min-w-0 items-center gap-1">
                  <MapPin className="size-3 shrink-0" aria-hidden="true" />
                  <span className="truncate">{location}</span>
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 border-t pt-3">
        {stats === undefined ? (
          <Skeleton className="h-3 w-28" />
        ) : stats === null ? null : (
          <p
            id={statsId}
            className="text-muted-foreground flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs"
          >
            <span>
              <span className="text-foreground font-semibold tabular-nums">
                {stats.puzzlesOwned}
              </span>{" "}
              {t("ownedLabel")}
            </span>
            <span>
              <span className="text-foreground font-semibold tabular-nums">
                {stats.tradesCompleted}
              </span>{" "}
              {t("swapsLabel")}
            </span>
            {rating ? (
              <span className="inline-flex items-center gap-1">
                <Star
                  className="size-3 fill-amber-400 text-amber-400"
                  aria-hidden="true"
                />
                {/* The visible number is hidden from AT; the sr-only sentence speaks it. */}
                <span
                  className="text-foreground font-semibold tabular-nums"
                  aria-hidden="true"
                >
                  {rating.formatted}
                </span>
                <span className="sr-only">
                  {t("ratingSr", {
                    rating: rating.formatted,
                    count: rating.count,
                  })}
                </span>
              </span>
            ) : (
              <span>{tReputation("noReviewsYet")}</span>
            )}
          </p>
        )}
        <div className="relative z-10 ml-auto flex shrink-0 items-center gap-1.5">
          <FollowButton memberId={memberId} memberName={name} iconOnly />
          <MessageButton memberId={memberId} memberName={name} iconOnly />
        </div>
      </div>
    </Card>
  );
}
