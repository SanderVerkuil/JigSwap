import { usePageHeader } from "@/components/dashboard-layout/page-header-slot";
import { DashboardShell } from "@/components/dashboard-layout/shell";
import { MarketingFooter } from "@/components/marketing/footer";
import { MarketingHeader } from "@/components/marketing/header";
import {
  ProfileBody,
  ProfileCtaBand,
  type PublicProfileView,
} from "@/components/members/profile-body";
import { Button } from "@/components/ui/button";
import { PageLoading } from "@/components/ui/loading";
import { gateway, Id } from "@/gateway";
import { pageTitle } from "@/lib/page-title";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import {
  createFileRoute,
  Link,
  notFound,
  redirect,
  useRouteContext,
} from "@tanstack/react-router";
import { Eye } from "lucide-react";
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
  loaderDeps: ({ search }) => ({ invite: search.invite }),
  loader: async ({ context, params, deps }) => {
    const profile = await context.queryClient.ensureQueryData(
      convexQuery(gateway.social.publicProfile, {
        handle: params.handle,
      }),
    );
    if (!profile) throw notFound();
    // Canonical display URL prefers the slug, then username; id URLs (QR/share
    // links) redirect. When neither exists the id URL is already canonical.
    const canonical =
      profile.hero.slug ?? profile.hero.username ?? profile.hero.memberId;
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
        title: loaderData?.profile
          ? `${loaderData.profile.hero.displayName} — JigSwap`
          : pageTitle(match.context, "members"),
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
  const { handle } = Route.useParams();
  const { invite } = Route.useSearch();
  const { data: profile } = useQuery(
    convexQuery(gateway.social.publicProfile, { handle }),
  );

  if (!profile) return <MemberPending />;

  // Logged-out: marketing chrome + the public profile body. The bottom sign-up
  // band only shows for a public (unlocked) profile — a private profile already
  // carries its own sign-up-to-follow prompt.
  if (!userId) {
    const returnToHref = `/members/${handle}${invite ? `?invite=${encodeURIComponent(invite)}` : ""}`;
    return (
      <div className="mk-root font-mk-sans flex min-h-screen flex-col overflow-x-clip">
        <MarketingHeader />
        <main className="flex-1">
          <ProfileBody
            profile={profile}
            viewer="public"
            returnToHref={returnToHref}
          />
          {!profile.locked && <ProfileCtaBand returnToHref={returnToHref} />}
        </main>
        <MarketingFooter />
      </div>
    );
  }

  return (
    <DashboardShell>
      <AuthedMemberPage profile={profile} />
    </DashboardShell>
  );
}

function AuthedMemberPage({ profile }: { profile: PublicProfileView }) {
  const tShell = useTranslations("shell");
  const memberId = profile.hero.memberId as Id<"users">;

  const { data: me } = useQuery(convexQuery(gateway.identity.currentUser, {}));
  const isSelf = me?._id === memberId;

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
      title: profile.hero.displayName,
      crumbs: [
        { label: tShell("groups.community.label"), href: "/community" },
        { label: tShell("pages.members.title"), href: "/people" },
      ],
      activeNavKey: "people",
    }),
    [profile.hero.displayName, tShell],
  );

  // `me` unresolved -> loading OR the post-signup provisioning race (null):
  // render pending until currentUser resolves so self-detection is reliable.
  if (!me) return <MemberPending />;

  return (
    <>
      {isSelf && <OwnerPreviewBanner locked={profile.locked} />}
      <ProfileBody
        profile={profile}
        shelf={shelf}
        viewer={isSelf ? "owner" : "member"}
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
    <div className="border-jigsaw-primary/20 bg-jigsaw-primary/5 mx-auto mb-6 flex w-full max-w-3xl flex-col gap-3 rounded-xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
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
  const t = useTranslations("members");
  const body = (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-24 text-center">
      <h1 className="font-heading text-2xl">{t("notFoundTitle")}</h1>
      <p className="text-muted-foreground">{t("notFoundSub")}</p>
      {userId ? (
        <Button asChild>
          <Link to="/people">{t("findPeople")}</Link>
        </Button>
      ) : (
        <Button asChild>
          <Link to="/">{t("backHome")}</Link>
        </Button>
      )}
    </div>
  );
  // App convention: 404 inside the authed app renders within the dashboard
  // shell (see _dashboard/route.tsx's notFoundComponent).
  if (userId) return <DashboardShell>{body}</DashboardShell>;
  return (
    <div className="mk-root font-mk-sans flex min-h-screen flex-col overflow-x-clip">
      <MarketingHeader />
      <main className="flex-1">{body}</main>
      <MarketingFooter />
    </div>
  );
}
