import { MAIN_CONTENT_ID } from "@/components/a11y/skip-link";
import { usePageHeader } from "@/components/dashboard-layout/page-header-slot";
import { DashboardShell } from "@/components/dashboard-layout/shell";
import { MarketingFooter } from "@/components/marketing/footer";
import { MarketingHeader } from "@/components/marketing/header";
import { canonicalHandleOf } from "@/components/members/canonical-handle";
import {
  ProfileBody,
  ProfileCtaBand,
  type PublicProfileView,
} from "@/components/members/profile-body";
import { lockedProfileFromTeaser } from "@/components/members/teaser-profile";
import { MarketingNotFoundContent } from "@/components/NotFound";
import { HouseholdLinkInvite } from "@/components/social/household-link-invite";
import {
  INVITE_KEY,
  shouldHandOffInvite,
} from "@/components/social/invite-landing";
import { QrFollowPrompt } from "@/components/social/qr-follow-prompt";
import { Button } from "@/components/ui/button";
import { PageLoading } from "@/components/ui/loading";
import { gateway, Id } from "@/gateway";
import { useMemberDisplayName } from "@/lib/member-display-name";
import { pageTitle } from "@/lib/page-title";
import { safeStorage } from "@/lib/safe-storage";
import { readSidebarCookies } from "@/lib/sidebar-state";
import { authorizeServerReads } from "@/lib/ssr-member-data";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  createFileRoute,
  Link,
  notFound,
  redirect,
  useNavigate,
  useRouteContext,
} from "@tanstack/react-router";
import { Eye } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslations } from "use-intl";

// The canonical member page (spec Phase 1): one URL for every viewer tier.
// Standalone route — OUTSIDE _dashboard (its beforeLoad requires auth) and
// outside _public (signed-in members get the dashboard shell instead), exactly
// like the public home route. Handle resolution, privacy gating, and the
// discriminated locked/unlocked payload live server-side in
// social/getPublicProfile (unauthenticated-capable).
export const Route = createFileRoute("/members/$handle")({
  // `invite` is tolerated (and preserved through the canonical redirect) so
  // later phases' QR/share links keep working; Phase 1 does not consume it.
  validateSearch: (search: Record<string, unknown>): { invite?: string } => ({
    invite: typeof search.invite === "string" ? search.invite : undefined,
  }),
  // Signed-in viewers get the dashboard shell: SSR needs the remembered sidebar state (UX-05).
  beforeLoad: () => ({ sidebar: readSidebarCookies() }),
  loaderDeps: ({ search }) => ({ invite: search.invite }),
  loader: async ({ context, params, deps }) => {
    // What these reads answer depends on the viewer. Without a token for a signed-in viewer the page
    // is left to the browser, which reads as them: no title from the profile for this load.
    if (!(await authorizeServerReads(context))) return { profile: null };
    const fullProfile = await context.queryClient.ensureQueryData(
      convexQuery(gateway.social.publicProfile, {
        handle: params.handle,
      }),
    );
    // Not openable, but maybe still known by name (teaser-profile.ts): a locked page, not a 404.
    const teaser = fullProfile
      ? null
      : await context.queryClient.ensureQueryData(
          convexQuery(gateway.social.publicMemberTeaser, {
            handle: params.handle,
          }),
        );
    const profile =
      fullProfile ?? (teaser ? lockedProfileFromTeaser(teaser) : null);
    if (!profile) throw notFound();
    // The server's canonical handle (slug, else a username that resolves back
    // to this member, else the id); id URLs (QR/share links) redirect to it.
    // Never rebuild it from `username`: another member may hold that string as
    // a slug (SEC-07). A backend that predates `handle` falls back to the slug,
    // else keeps the requested handle (it just resolved to this member), so
    // slug and username URLs keep working and the redirect never targets
    // undefined.
    const canonical = canonicalHandleOf(profile.hero, params.handle);
    if (canonical !== params.handle) {
      throw redirect({
        to: "/members/$handle",
        params: { handle: canonical },
        search: deps.invite ? { invite: deps.invite } : {},
        replace: true,
      });
    }
    return { profile };
  },
  // `loaderData` is safe to read here: on the SSR pass TanStack Start resolves
  // every loader before executeHead runs, and SSR is the pass crawlers/social
  // scrapers see — so the member's name in <title> and the private-profile
  // noindex are reliably in the served HTML. A momentarily stale title on client
  // navigation is acceptable. The dynamic entity title is intentional (public
  // member pages are shareable/indexable per the spec); the pre-load fallback
  // reuses the localized page-title machinery.
  head: ({ loaderData, match }) => ({
    meta: [
      {
        title: loaderData?.profile?.hero.displayName
          ? `${loaderData.profile.hero.displayName} — JigSwap`
          : pageTitle(
              match.context,
              match.status === "notFound" ? "notFound" : "members",
            ),
      },
      ...(loaderData?.profile?.hero.visibility === "private"
        ? [{ name: "robots", content: "noindex" }]
        : []),
    ],
  }),
  pendingComponent: MemberPending,
  notFoundComponent: MemberNotFound,
  component: MemberPage,
});

// Shared localized loading state (route pending + in-page query waits).
function MemberPending() {
  const t = useTranslations("members");
  return <PageLoading message={t("loading")} />;
}

function MemberPage() {
  const { userId } = useRouteContext({ from: "__root__" });
  const sidebar = Route.useRouteContext({ select: (c) => c.sidebar });
  const displayName = useMemberDisplayName();
  const { handle } = Route.useParams();
  const { invite } = Route.useSearch();
  const { data: fullProfile } = useQuery(
    convexQuery(gateway.social.publicProfile, { handle }),
  );
  // The loader's fallback, kept reactive: only asked once the full profile reads as null.
  const { data: teaser } = useQuery({
    ...convexQuery(gateway.social.publicMemberTeaser, { handle }),
    enabled: fullProfile === null,
  });
  const profile =
    fullProfile ?? (teaser ? lockedProfileFromTeaser(teaser) : undefined);

  // Does `?invite=<token>` point at a live invite for THIS profile, and is it
  // the member's network link or a household link? No owner data. Phase 3
  // growth loop; household links per the quick-start spec §3.4.
  const { data: inviteContext } = useQuery({
    ...convexQuery(gateway.social.inviteContext, {
      token: invite ?? "",
      memberId: (profile?.hero.memberId ?? "") as Id<"users">,
    }),
    enabled: invite !== undefined && profile !== undefined,
  });
  const inviteValid = inviteContext?.valid === true;
  const inviteKind = inviteContext?.kind ?? "network";
  // Expired or used household links say so; a dead network link stays silent.
  const inviteExpired =
    inviteContext !== undefined && !inviteValid && inviteKind === "household";

  const { mutate: recordLanding } = useMutation({
    mutationFn: useConvexMutation(gateway.social.recordInviteLanding),
  });

  // Persist the token for post-signup redemption (the sign-up CTA also carries
  // it in redirect_url; InviteRedeemer redeems it) and count the landing once
  // per browser session per token. Only for a logged-out visitor on a live
  // invite. safeStorage degrades gracefully when storage is blocked.
  useEffect(() => {
    if (!invite || !inviteValid || userId) return;
    safeStorage.setItem("local", INVITE_KEY, invite);
    const sessionKey = `jigswap.inviteLanded.${invite}`;
    if (safeStorage.getItem("session", sessionKey)) return;
    safeStorage.setItem("session", sessionKey, "1");
    recordLanding({ token: invite });
  }, [invite, inviteValid, userId, recordLanding]);

  // Only the browser finds this out when the loader left the page to it.
  if (fullProfile === null && teaser === null) return <MemberNotFound />;
  if (!profile) return <MemberPending />;

  // Logged-out: marketing chrome + the public profile body. The bottom sign-up
  // band only shows for a public (unlocked) profile — a private profile already
  // carries its own sign-up-to-follow prompt.
  if (!userId) {
    const returnToHref = `/members/${handle}${invite ? `?invite=${encodeURIComponent(invite)}` : ""}`;
    return (
      <div className="mk-root font-mk-sans flex min-h-screen flex-col overflow-x-clip">
        <MarketingHeader />
        <main id={MAIN_CONTENT_ID} className="flex-1">
          <ProfileBody
            profile={profile}
            viewer="public"
            returnToHref={returnToHref}
            invitedName={
              inviteValid
                ? displayName({ name: profile.hero.displayName })
                : undefined
            }
            invitedKind={inviteKind}
            inviteExpired={inviteExpired}
            requestedHandle={handle}
          />
          {!profile.locked && <ProfileCtaBand returnToHref={returnToHref} />}
        </main>
        <MarketingFooter />
      </div>
    );
  }

  return (
    <DashboardShell sidebar={sidebar}>
      <AuthedMemberPage
        profile={profile}
        invite={invite}
        inviteValid={inviteValid}
        inviteKind={inviteKind}
      />
    </DashboardShell>
  );
}

function AuthedMemberPage({
  profile,
  invite,
  inviteValid,
  inviteKind,
}: {
  profile: PublicProfileView;
  invite: string | undefined;
  inviteValid: boolean;
  inviteKind: "network" | "household";
}) {
  const tShell = useTranslations("shell");
  const displayName = useMemberDisplayName();
  const { handle } = Route.useParams();
  const name = displayName({ name: profile.hero.displayName });
  const memberId = profile.hero.memberId as Id<"users">;

  const { data: me } = useQuery(convexQuery(gateway.identity.currentUser, {}));
  const isSelf = me?._id === memberId;
  const navigate = useNavigate();

  // Clerk's sign-up returns here (redirect_url), but this page renders outside
  // the _dashboard layout, so InviteRedeemer never runs on it. A brand-new
  // member on a live invite: (re)store the token — the ?invite on the URL
  // re-seeds it even if storage was lost across the redirect — and go to the
  // dashboard, where InviteRedeemer redeems it. Existing members stay here.
  // The page's first-render time: Date.now() can't run during render, and a stale "now" only
  // matters at the 15-minute boundary, which the server enforces anyway.
  const [now] = useState(() => Date.now());
  const handingOff =
    me !== null &&
    me !== undefined &&
    invite !== undefined &&
    shouldHandOffInvite({
      memberCreatedAt: me.createdAt,
      isSelf,
      invite,
      inviteValid,
      now,
    });
  useEffect(() => {
    if (!handingOff || !invite) return;
    safeStorage.setItem("local", INVITE_KEY, invite);
    void navigate({ to: "/dashboard", replace: true });
  }, [handingOff, invite, navigate]);

  // The featured shelf is auth-gated (requireMember) and only exists on an
  // unlocked profile; skip it while `me` is unresolved and for locked profiles.
  const { data: shelf } = useQuery(
    convexQuery(
      gateway.social.featuredShelf,
      !me || profile.locked ? "skip" : { userId: memberId },
    ),
  );

  // Publish the shell page head: the member's display name as the leaf title
  // under a Community › Members trail. Hook stays above the early return.
  usePageHeader(
    () => ({
      title: name,
      // ProfileBody's hero renders the name as this page's h1 once `me` resolves: the head then
      // keeps it only as the breadcrumb leaf, so the name isn't printed twice.
      titleInContent: Boolean(me),
      crumbs: [
        { label: tShell("groups.community.label"), href: "/community" },
        { label: tShell("pages.members.title"), href: "/people" },
      ],
      activeNavKey: "people",
    }),
    [name, tShell, Boolean(me)],
  );

  // `me` unresolved -> loading OR the post-signup provisioning race (null):
  // render pending until currentUser resolves so self-detection is reliable.
  if (!me) return <MemberPending />;

  return (
    <>
      {isSelf && <OwnerPreviewBanner locked={profile.locked} />}
      {!isSelf && invite && inviteValid && inviteKind === "network" && (
        <QrFollowPrompt token={invite} name={name} memberId={memberId} />
      )}
      {!isSelf && !handingOff && invite && inviteKind === "household" && (
        <HouseholdLinkInvite token={invite} fallbackName={name} />
      )}
      <ProfileBody
        profile={profile}
        shelf={shelf}
        viewer={isSelf ? "owner" : "member"}
        requestedHandle={handle}
      />
    </>
  );
}

// Owner-preview banner: signed-in self no longer redirects to /profile — they
// see exactly what visitors see, with an explicit "this is a preview" frame and
// escape hatches back to editing / the app. For a private profile the body
// shows the locked state; the banner notes that approved followers see it all.
function OwnerPreviewBanner({ locked }: { locked: boolean }) {
  const t = useTranslations("members.profile");
  return (
    <div className="border-jigsaw-primary/20 bg-jigsaw-primary/5 mb-6 flex w-full flex-col gap-3 rounded-xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2.5">
        <Eye className="text-jigsaw-primary mt-0.5 size-4 shrink-0" />
        <p className="text-muted-foreground text-sm">
          {locked ? t("previewBannerPrivate") : t("previewBanner")}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button asChild size="sm" variant="outline">
          <Link to="/dashboard">{t("backToApp")}</Link>
        </Button>
        <Button asChild size="sm">
          <Link to="/profile">{t("editProfile")}</Link>
        </Button>
      </div>
    </div>
  );
}

function MemberNotFound() {
  const { userId } = useRouteContext({ from: "__root__" });
  const sidebar = Route.useRouteContext({ select: (c) => c.sidebar });
  const t = useTranslations("members");
  // App convention: 404 inside the authed app renders within the dashboard
  // shell (see _dashboard/route.tsx's notFoundComponent).
  if (userId) {
    return (
      <DashboardShell sidebar={sidebar}>
        <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-24 text-center">
          <h1 className="font-heading text-2xl">{t("notFoundTitle")}</h1>
          <p className="text-muted-foreground">{t("notFoundSub")}</p>
          <Button asChild>
            <Link to="/people">{t("findPeople")}</Link>
          </Button>
        </div>
      </DashboardShell>
    );
  }
  return (
    <div className="mk-root font-mk-sans flex min-h-screen flex-col overflow-x-clip">
      <MarketingHeader />
      <main id={MAIN_CONTENT_ID} className="flex-1">
        <MarketingNotFoundContent
          title={t("notFoundTitle")}
          message={t("notFoundSub")}
        />
      </main>
      <MarketingFooter />
    </div>
  );
}
