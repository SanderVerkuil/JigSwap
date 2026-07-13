import { pageTitle } from "@/lib/page-title";
import { createFileRoute } from "@tanstack/react-router";

import { EmptyState } from "@/components/community/primitives";
import { SectionHead } from "@/components/dashboard-home/section-head";
import { usePageHeaderActions } from "@/components/dashboard-layout/page-header-slot";
import { ActivityFeed } from "@/components/social/activity-feed";
import { FollowRequestsStrip } from "@/components/social/follow-requests-strip";
import {
  MemberTile,
  MemberTileSkeleton,
} from "@/components/social/member-tile";
import { ProfileEditDialog } from "@/components/social/profile-edit-dialog";
import { QrDialog } from "@/components/social/qr-dialog";
import { gateway, Id } from "@/gateway";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { useTranslations } from "use-intl";

export const Route = createFileRoute("/_dashboard/people")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "people") }],
  }),
  component: PeoplePage,
});

// People (the Community social hub): the members in your network — everyone
// you follow plus everyone following you, deduplicated — as a grid of member
// tiles, then the full-width activity feed of you + the people you follow,
// with a profile-edit dialog trigger beside the activity heading. The page
// title renders in the shell head.
function PeoplePage() {
  const t = useTranslations("people");

  const { data: following } = useQuery(
    convexQuery(gateway.social.following, {}),
  );
  const { data: followers } = useQuery(
    convexQuery(gateway.social.followers, {}),
  );
  const { data: me } = useQuery(convexQuery(gateway.identity.currentUser, {}));

  const loading = following === undefined || followers === undefined;

  // Dedupe both follow directions into one network; remember who follows you
  // so the tile can carry a "Follows you" badge.
  const followerIds = new Set((followers ?? []).map((edge) => edge.memberId));
  const network = new Map<string, { followsYou: boolean }>();
  for (const edge of following ?? []) {
    network.set(edge.memberId, { followsYou: followerIds.has(edge.memberId) });
  }
  for (const edge of followers ?? []) {
    if (!network.has(edge.memberId)) {
      network.set(edge.memberId, { followsYou: true });
    }
  }
  const members = Array.from(network.entries());

  // The page title ("People") lives in the shell page head; publish the network
  // member count there too so the body carries no duplicate section header.
  const headerMeta = loading
    ? undefined
    : t("memberCount", { count: members.length });
  usePageHeaderActions(
    () => (
      <div className="flex items-center gap-3">
        {me ? (
          <QrDialog
            memberId={me._id}
            displayName={me.name}
            username={me.username}
            avatarUrl={me.avatar}
          />
        ) : null}
        {headerMeta ? (
          <span className="text-muted-foreground hidden text-sm sm:inline">
            {headerMeta}
          </span>
        ) : null}
      </div>
    ),
    [headerMeta, me],
  );

  return (
    <div className="flex flex-col gap-10">
      <FollowRequestsStrip />

      <section>
        {loading ? (
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
            {Array.from({ length: 3 }).map((_, i) => (
              <MemberTileSkeleton key={i} />
            ))}
          </div>
        ) : members.length === 0 ? (
          <EmptyState title={t("emptyTitle")} sub={t("emptySub")} />
        ) : (
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
            {members.map(([memberId, { followsYou }]) => (
              <MemberTile
                key={memberId}
                memberId={memberId as Id<"users">}
                followsYou={followsYou}
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionHead
          title={t("activity")}
          icon={Bell}
          action={<ProfileEditDialog />}
        />
        <ActivityFeed />
      </section>
    </div>
  );
}
