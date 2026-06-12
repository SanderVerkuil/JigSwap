import { pageTitle } from "@/lib/page-title";
import { createFileRoute } from "@tanstack/react-router";

import { ActivityFeed } from "@/components/social/activity-feed";
import { FollowList } from "@/components/social/follow-list";
import { ProfileEditor } from "@/components/social/profile-editor";

export const Route = createFileRoute("/_dashboard/people")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "people") }],
  }),
  component: PeoplePage,
});

// People (moved here from /community, which is now the Community group
// landing): edit your public profile, see who follows you (and whom you
// follow), and a unified activity feed of your own + followed members'
// activity. The "People" title/subtitle render in the shell page head.
function PeoplePage() {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Activity feed</h2>
          <ActivityFeed />
        </section>
      </div>

      <div className="space-y-6">
        <ProfileEditor />

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Following</h2>
          <FollowList
            variant="following"
            emptyHint="You are not following anyone yet."
          />
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Followers</h2>
          <FollowList
            variant="followers"
            emptyHint="No one is following you yet."
          />
        </section>
      </div>
    </div>
  );
}
