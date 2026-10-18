// A member page for a profile the viewer can't open but may still know by name: getPublicProfile
// is not-found, yet getPublicMemberTeaser answers (today: a circle-mate who blocked the viewer,
// whom the circle keeps naming, §5.3). Rendered as a locked profile carrying the teaser's identity
// only (counts and rating zeroed, no location), so the page reads like any locked profile instead
// of a not-found that would give the block away. Pure, so it unit-tests without React.
import type { gateway } from "@/gateway";
import type { FunctionReturnType } from "convex/server";
import type { PublicProfileView } from "./profile-body";

type Teaser = NonNullable<
  FunctionReturnType<typeof gateway.social.publicMemberTeaser>
>;

export function lockedProfileFromTeaser(teaser: Teaser): PublicProfileView {
  return {
    locked: true,
    hero: {
      memberId: teaser.memberId,
      displayName: teaser.displayName,
      username: teaser.username,
      slug: teaser.slug,
      avatar: teaser.avatar,
      memberSince: teaser.memberSince,
      rating: 0,
      reviewCount: 0,
      followerCount: 0,
      followingCount: 0,
      visibility: teaser.visibility,
    },
  };
}
