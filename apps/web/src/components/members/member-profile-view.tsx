"use client";

// Full member profile for viewers the privacy gate admits (public profile, or
// mutual follower): identity header with Follow/Message, the people-hub stat
// row, the curated featured shelf (hidden when uncurated), and the bio.
// All reads are the existing privacy-gated identity/social queries.

import { MemberIdentityHeader } from "@/components/members/member-identity-header";
import { FollowButton } from "@/components/social/follow-button";
import { MessageButton } from "@/components/social/message-button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { gateway, Id } from "@/gateway";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import type { FunctionReturnType } from "convex/server";
import { Star } from "lucide-react";
import { useTranslations } from "use-intl";

// The web tier derives Convex view types from the gateway (not @jigswap/contracts directly).
type MemberView = NonNullable<FunctionReturnType<typeof gateway.identity.byId>>;

export function MemberProfileView({ member }: { member: MemberView }) {
  const t = useTranslations("members");
  const tPeople = useTranslations("people");
  const memberId = member._id as Id<"users">;

  const { data: profile } = useQuery(
    convexQuery(gateway.social.profile, { memberId }),
  );
  const { data: stats } = useQuery(
    convexQuery(gateway.identity.userStats, { userId: memberId }),
  );
  const { data: shelf } = useQuery(
    convexQuery(gateway.social.featuredShelf, { userId: memberId }),
  );

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <MemberIdentityHeader
        displayName={profile?.displayName ?? member.name}
        username={member.username}
        avatar={member.avatar}
        memberSince={member.createdAt}
        location={member.location}
        actions={
          <>
            <FollowButton memberId={memberId} />
            <MessageButton memberId={memberId} />
          </>
        }
      />

      {stats === undefined ? (
        <Skeleton className="h-16 w-full" />
      ) : stats === null ? null : (
        <div className="grid grid-cols-3 divide-x rounded-lg border">
          <StatCell value={stats.puzzlesOwned} label={tPeople("ownedLabel")} />
          <StatCell
            value={stats.tradesCompleted}
            label={tPeople("swapsLabel")}
          />
          <div className="flex flex-col items-center gap-0.5 p-4">
            <span className="inline-flex items-center gap-1 text-xl font-bold">
              <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
              {stats.totalReviews > 0 ? stats.averageRating.toFixed(1) : "–"}
            </span>
          </div>
        </div>
      )}

      {shelf && shelf.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-heading text-xl">{t("shelfTitle")}</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {shelf.map((copy) => (
              <Card key={copy._id} className="overflow-hidden p-0">
                {copy.coverUrl ? (
                  <img
                    src={copy.coverUrl}
                    alt={copy.puzzle?.title ?? copy.snapshot?.title ?? ""}
                    className="aspect-square w-full object-cover"
                  />
                ) : (
                  <div className="bg-muted aspect-square w-full" />
                )}
                <p className="truncate p-2 text-sm font-medium">
                  {copy.puzzle?.title ?? copy.snapshot?.title}
                </p>
              </Card>
            ))}
          </div>
        </section>
      )}

      {member.bio && (
        <section className="flex flex-col gap-2">
          <h2 className="font-heading text-xl">{t("bioTitle")}</h2>
          <p className="text-muted-foreground whitespace-pre-wrap">
            {member.bio}
          </p>
        </section>
      )}
    </div>
  );
}

function StatCell({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5 p-4">
      <span className="text-xl font-bold">{value}</span>
      <span className="text-muted-foreground text-xs">{label}</span>
    </div>
  );
}
