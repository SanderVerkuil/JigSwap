"use client";

// Logged-in, non-mutual view of a private member: full identity header (the
// person feels present, not withheld) + the quiet private card + the follow
// action. Phase 1 keeps today's instant follow; the request-to-follow flow
// replaces this button in Phase 2. No Message button — messaging is
// connection-gated anyway.

import { type PublicMemberTeaserView } from "@/components/members/logged-out-teaser";
import { MemberIdentityHeader } from "@/components/members/member-identity-header";
import { PrivateProfileCard } from "@/components/members/private-profile-card";
import { FollowButton } from "@/components/social/follow-button";
import { Id } from "@/gateway";

export function PrivateInterstitial({
  teaser,
}: {
  teaser: PublicMemberTeaserView;
}) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
      <MemberIdentityHeader
        displayName={teaser.displayName}
        username={teaser.username}
        avatar={teaser.avatar}
        memberSince={teaser.memberSince}
      />
      <PrivateProfileCard displayName={teaser.displayName} />
      <div className="flex justify-center">
        <FollowButton memberId={teaser.memberId as Id<"users">} />
      </div>
    </div>
  );
}
