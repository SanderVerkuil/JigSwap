"use client";

// A community member as a self-contained tile (one of the sanctioned card
// uses): large avatar, bold name, muted map-pin location, and a mini-stat row
// of owned copies, completed swaps and trade rating — everything sourced from
// the existing identity reads (getUserById + getUserStats). A "Follows you"
// badge plus the follow/unfollow toggle and the connection-gated Message
// button keep the social actions on the tile.

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { gateway, Id } from "@/gateway";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { MapPin, Star } from "lucide-react";
import { useTranslations } from "use-intl";
import { FollowButton } from "./follow-button";
import { MessageButton } from "./message-button";

export function MemberTileSkeleton() {
  return (
    <Card className="flex flex-row items-center gap-3.5 p-3.5">
      <Skeleton className="size-12 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-1/2" />
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

  return (
    <Card className="flex flex-row items-center gap-3.5 p-3.5">
      <Avatar className="size-12 shrink-0">
        {member.avatar && <AvatarImage src={member.avatar} alt={member.name} />}
        <AvatarFallback>{member.name.charAt(0).toUpperCase()}</AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Link
            to="/members/$handle"
            params={{ handle: member.username ?? member._id }}
            className="truncate text-base font-bold hover:underline"
          >
            {member.name}
          </Link>
          {followsYou && (
            <Badge variant="secondary" className="shrink-0">
              {t("followsYou")}
            </Badge>
          )}
        </div>
        {!hideLocation && member.location && (
          <div className="text-muted-foreground mt-0.5 flex items-center gap-1 text-xs">
            <MapPin className="h-3 w-3 shrink-0" />
            <span className="truncate">{member.location}</span>
          </div>
        )}
        <div className="text-muted-foreground mt-2 flex items-center gap-3 text-xs">
          {stats === undefined ? (
            <Skeleton className="h-3 w-32" />
          ) : stats === null ? null : (
            <>
              <span>
                <strong className="text-foreground">
                  {stats.puzzlesOwned}
                </strong>{" "}
                {t("ownedLabel")}
              </span>
              <span>
                <strong className="text-foreground">
                  {stats.tradesCompleted}
                </strong>{" "}
                {t("swapsLabel")}
              </span>
              <span className="inline-flex items-center gap-0.5">
                <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                <strong className="text-foreground">
                  {stats.totalReviews > 0
                    ? stats.averageRating.toFixed(1)
                    : "–"}
                </strong>
              </span>
            </>
          )}
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-stretch gap-1.5">
        <FollowButton memberId={memberId} size="sm" memberName={member.name} />
        <MessageButton memberId={memberId} size="sm" />
      </div>
    </Card>
  );
}
