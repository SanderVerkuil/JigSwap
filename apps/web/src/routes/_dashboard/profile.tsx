import { usePageHeaderActions } from "@/components/dashboard-layout/page-header-slot";
import { EditProfileForm } from "@/components/profile/edit-profile-form";
import { IdentityHeader } from "@/components/profile/identity-header";
import { PrivacySection } from "@/components/profile/privacy-section";
import { ProfileShelfSection } from "@/components/profile/shelf-section";
import { ProfileStatsSection } from "@/components/profile/stats-section";
import { ReputationSection } from "@/components/reputation/reputation-section";
import { QrDialog } from "@/components/social/qr-dialog";
import { PageLoading } from "@/components/ui/loading";
import { gateway, Id } from "@/gateway";
import { pageTitle } from "@/lib/page-title";
import { validateProfileSearch } from "@/lib/profile-search";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslations } from "use-intl";

// The member's own profile, in the open card-free language: identity header
// (avatar, name, meta row, trust badge, edit toggle) → "{FirstName}'s Shelf"
// on the puzzle plank → four divided stat columns → received reputation. The
// always-visible Privacy section (#privacy; its settings save instantly) sits
// right under the identity (and the Edit Profile form when open), so a deep
// link lands on it before the slower sections below have loaded.
// The shell chrome owns the "Profile" page title, so there is no page h1 here.
export const Route = createFileRoute("/_dashboard/profile")({
  // `edit` opens the Edit Profile form from elsewhere (see profile-search.ts).
  validateSearch: validateProfileSearch,
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "profile") }],
  }),
  pendingComponent: () => <PageLoading />,
  component: ProfilePage,
});

function ProfilePage() {
  const t = useTranslations("profile");
  const { edit } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const [editOpenedHere, setEditOpenedHere] = useState(false);
  // Open when opened from this page, or when arriving via ?edit (the QR dialog, the public
  // preview). The flag lives in the URL, so closing drops it (replace: Back must not reopen it).
  const isEditing = editOpenedHere || edit !== undefined;
  const setIsEditing = (open: boolean) => {
    setEditOpenedHere(open);
    if (!open && edit !== undefined) {
      void navigate({ search: {}, replace: true, resetScroll: false });
    }
  };

  const { data: member } = useQuery(
    convexQuery(gateway.identity.currentUser, {}),
  );

  usePageHeaderActions(
    () =>
      member ? (
        <QrDialog
          memberId={member._id}
          displayName={member.name}
          username={member.username}
          handle={member.handle}
          avatarUrl={member.avatar}
        />
      ) : null,
    [member],
  );

  if (member === undefined) {
    return <PageLoading message={t("loading")} />;
  }

  if (member === null) {
    return <div>{t("notFound")}</div>;
  }

  return (
    <div className="flex w-full flex-col gap-8 md:gap-9">
      <IdentityHeader
        member={member}
        isEditing={isEditing}
        onToggleEdit={() => setIsEditing(!isEditing)}
      />
      {isEditing && (
        <EditProfileForm
          member={member}
          focusCustomLink={edit === "link"}
          onDone={() => setIsEditing(false)}
        />
      )}
      <PrivacySection />
      <ProfileShelfSection member={member} />
      <ProfileStatsSection member={member} />
      <ReputationSection memberId={member._id as Id<"users">} />
    </div>
  );
}
