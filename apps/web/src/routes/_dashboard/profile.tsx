import { pageTitle } from "@/lib/page-title";
import { createFileRoute } from "@tanstack/react-router";

import { EditProfileForm } from "@/components/profile/edit-profile-form";
import { IdentityHeader } from "@/components/profile/identity-header";
import { ProfileShelfSection } from "@/components/profile/shelf-section";
import { ProfileStatsSection } from "@/components/profile/stats-section";
import { ReputationSection } from "@/components/reputation/reputation-section";
import { PageLoading } from "@/components/ui/loading";
import { gateway, Id } from "@/gateway";
import { useQuery } from "convex/react";
import { useState } from "react";
import { useTranslations } from "use-intl";

// The member's own profile, in the open card-free language: identity header
// (avatar, name, meta row, trust badge, edit toggle) → "{FirstName}'s Shelf"
// on the puzzle plank → four divided stat columns → received reputation.
// The shell chrome owns the "Profile" page title, so there is no page h1 here.
export const Route = createFileRoute("/_dashboard/profile")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "profile") }],
  }),
  pendingComponent: () => <PageLoading message="Loading profile..." />,
  component: ProfilePage,
});

function ProfilePage() {
  const t = useTranslations("profile");
  const [isEditing, setIsEditing] = useState(false);

  const member = useQuery(gateway.identity.currentUser);

  if (member === undefined) {
    return <PageLoading message={t("loading")} />;
  }

  if (member === null) {
    return <div>{t("notFound")}</div>;
  }

  return (
    <div className="mx-auto flex w-full max-w-[1000px] flex-col gap-8 md:gap-9">
      <IdentityHeader
        member={member}
        isEditing={isEditing}
        onToggleEdit={() => setIsEditing((editing) => !editing)}
      />
      {isEditing && (
        <EditProfileForm member={member} onDone={() => setIsEditing(false)} />
      )}
      <ProfileShelfSection member={member} />
      <ProfileStatsSection member={member} />
      <ReputationSection memberId={member._id as Id<"users">} />
    </div>
  );
}
