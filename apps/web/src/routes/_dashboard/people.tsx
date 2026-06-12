import { pageTitle } from "@/lib/page-title";
import { createFileRoute } from "@tanstack/react-router";

import { EmptyState } from "@/components/community/primitives";
import { SectionHead } from "@/components/dashboard-home/section-head";
import { ActivityFeed } from "@/components/social/activity-feed";
import { MemberTile, MemberTileSkeleton } from "@/components/social/member-tile";
import { ProfileEditor } from "@/components/social/profile-editor";
import { gateway, Id } from "@/gateway";
import { useQuery } from "convex/react";
import { Bell, Globe } from "lucide-react";
import { useTranslations } from "use-intl";

export const Route = createFileRoute("/_dashboard/people")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "people") }],
  }),
  component: PeoplePage,
});

// People (the Community social hub): the members in your network — everyone
// you follow plus everyone following you, deduplicated — as a grid of member
// tiles, then the activity feed of you + the people you follow, with your
// public profile editor alongside. The page title renders in the shell head.
function PeoplePage() {
  const t = useTranslations("people");

  const following = useQuery(gateway.social.following, {});
  const followers = useQuery(gateway.social.followers, {});

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

  return (
    <div className="flex flex-col gap-10">
      <section>
        <SectionHead
          title={t("yourNetwork")}
          icon={Globe}
          meta={loading ? undefined : t("memberCount", { count: members.length })}
        />
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

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-3">
        <section className="lg:col-span-2">
          <SectionHead title={t("activity")} icon={Bell} />
          <ActivityFeed />
        </section>
        <div>
          <ProfileEditor />
        </div>
      </div>
    </div>
  );
}
