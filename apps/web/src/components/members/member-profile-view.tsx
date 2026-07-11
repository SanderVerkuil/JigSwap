"use client";

// Full member profile for viewers the privacy gate admits (public profile, or
// mutual follower): identity header with Follow/Message, the people-hub stat
// row, the curated featured shelf (hidden when uncurated), and the bio.
// All reads are the existing privacy-gated identity/social queries.

import { MemberIdentityHeader } from "@/components/members/member-identity-header";
import { SectionHead } from "@/components/puzzles/catalog-detail-parts";
import { PuzzleCardShell } from "@/components/puzzles/puzzle-card-shell";
import { PuzzleViewProvider } from "@/components/puzzles/puzzle-view-provider";
import { FollowButton } from "@/components/social/follow-button";
import { MessageButton } from "@/components/social/message-button";
import { Skeleton } from "@/components/ui/skeleton";
import { gateway, Id } from "@/gateway";
import { cn } from "@/lib/utils";
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
        // Open, card-free stat row (matches ProfileStatsSection / StatsBar): big
        // font-heading figures straight on the page ground, hairline dividers.
        <div className="grid grid-cols-3">
          <StatCell value={stats.puzzlesOwned} label={tPeople("ownedLabel")} />
          <StatCell
            value={stats.tradesCompleted}
            label={tPeople("swapsLabel")}
            className="border-l"
          />
          <div className="border-l px-3 text-center">
            <span className="font-heading text-jigsaw-primary inline-flex items-center gap-1.5 text-4xl leading-none font-bold">
              <Star className="size-6 fill-amber-400 text-amber-400" />
              {stats.totalReviews > 0 ? stats.averageRating.toFixed(1) : "–"}
            </span>
            <div className="text-muted-foreground mt-2 text-sm">
              {t("ratingLabel")}
            </div>
          </div>
        </div>
      )}

      {shelf && shelf.length > 0 && (
        <section>
          <SectionHead
            icon={<Star className="size-5" />}
            title={t("shelfTitle")}
          />
          {/* App idiom: the shared PuzzleCardShell in the auto-fill puzzle grid,
              so featured copies read exactly like the catalogue/library cards. */}
          <PuzzleViewProvider viewMode="grid">
            {shelf.map((copy) => (
              <PuzzleCardShell
                key={copy._id}
                puzzle={{
                  id: copy._id,
                  title: copy.puzzle?.title ?? copy.snapshot?.title ?? "",
                  brand: copy.puzzle?.brand,
                  pieceCount: copy.puzzle?.pieceCount,
                  difficulty: copy.puzzle?.difficulty,
                  imageUrl: copy.coverUrl,
                }}
                imageHref={`/copies/${copy._id}`}
              />
            ))}
          </PuzzleViewProvider>
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

function StatCell({
  value,
  label,
  className,
}: {
  value: number;
  label: string;
  className?: string;
}) {
  return (
    <div className={cn("px-3 text-center", className)}>
      <div className="font-heading text-jigsaw-primary text-4xl leading-none font-bold">
        {value}
      </div>
      <div className="text-muted-foreground mt-2 text-sm">{label}</div>
    </div>
  );
}
