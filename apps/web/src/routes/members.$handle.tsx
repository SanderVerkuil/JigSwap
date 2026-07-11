import { usePageHeader } from "@/components/dashboard-layout/page-header-slot";
import { DashboardShell } from "@/components/dashboard-layout/shell";
import { MarketingFooter } from "@/components/marketing/footer";
import { MarketingHeader } from "@/components/marketing/header";
import {
  LoggedOutTeaser,
  type PublicMemberTeaserView,
} from "@/components/members/logged-out-teaser";
import { MemberProfileView } from "@/components/members/member-profile-view";
import { PrivateInterstitial } from "@/components/members/private-interstitial";
import { Button } from "@/components/ui/button";
import { PageLoading } from "@/components/ui/loading";
import { gateway, Id } from "@/gateway";
import { pageTitle } from "@/lib/page-title";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import {
  createFileRoute,
  Link,
  Navigate,
  notFound,
  redirect,
  useRouteContext,
} from "@tanstack/react-router";
import { useTranslations } from "use-intl";

// The canonical member page (spec Phase 1): one URL for every viewer tier.
// Standalone route — OUTSIDE _dashboard (its beforeLoad requires auth) and
// outside _public (signed-in members get the dashboard shell instead), exactly
// like the public home route. Handle resolution and the strictly-limited
// anonymous payload live server-side in social/getPublicMemberTeaser.
export const Route = createFileRoute("/members/$handle")({
  // `invite` is tolerated (and preserved through the canonical redirect) so
  // Phase 3 QR/share links keep working; Phase 1 does not consume it.
  validateSearch: (search: Record<string, unknown>): { invite?: string } => ({
    invite: typeof search.invite === "string" ? search.invite : undefined,
  }),
  loaderDeps: ({ search }) => ({ invite: search.invite }),
  loader: async ({ context, params, deps }) => {
    const teaser = await context.queryClient.ensureQueryData(
      convexQuery(gateway.social.publicMemberTeaser, {
        handle: params.handle,
      }),
    );
    if (!teaser) throw notFound();
    // Canonical display URL is the username; id URLs (QR/share links) redirect.
    if (teaser.username && teaser.username !== params.handle) {
      throw redirect({
        to: "/members/$handle",
        params: { handle: teaser.username },
        search: deps.invite ? { invite: deps.invite } : {},
        replace: true,
      });
    }
    return { teaser };
  },
  // `loaderData` is safe to read here despite the page-title helper's caveat:
  // on the SSR pass TanStack Start resolves every loader before executeHead
  // runs (router-core's loadMatches awaits the matchPromises before its
  // headMaxIndex loop), and SSR is the pass crawlers/social scrapers see — so
  // the member's name in <title> and the private-profile noindex are reliably
  // in the served HTML. On client navigations a momentarily stale title is
  // possible and acceptable. The dynamic entity title is intentional (public
  // member pages are shareable/indexable per the spec); the pre-load fallback
  // reuses the localized page-title machinery instead of hand-rolling one.
  head: ({ loaderData, match }) => ({
    meta: [
      {
        title: loaderData?.teaser
          ? `${loaderData.teaser.displayName} — JigSwap`
          : pageTitle(match.context, "members"),
      },
      ...(loaderData?.teaser?.visibility === "private"
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
  const { data: teaser } = useQuery(
    convexQuery(gateway.social.publicMemberTeaser, { handle }),
  );

  if (!teaser) return <MemberPending />;

  if (!userId) {
    const returnToHref = `/members/${handle}${invite ? `?invite=${encodeURIComponent(invite)}` : ""}`;
    return (
      <div className="mk-root font-mk-sans min-h-screen overflow-x-clip">
        <MarketingHeader />
        <main>
          <LoggedOutTeaser teaser={teaser} returnToHref={returnToHref} />
        </main>
        <MarketingFooter />
      </div>
    );
  }

  return (
    <DashboardShell>
      <AuthedMemberPage
        memberId={teaser.memberId as Id<"users">}
        teaser={teaser}
      />
    </DashboardShell>
  );
}

function AuthedMemberPage({
  memberId,
  teaser,
}: {
  memberId: Id<"users">;
  teaser: PublicMemberTeaserView;
}) {
  const tShell = useTranslations("shell");
  const { data: me } = useQuery(convexQuery(gateway.identity.currentUser, {}));
  // Privacy-gated tier discriminator: getUserById returns null for a private
  // non-mutual target (and only then, for an existing active member). The hook
  // call stays unconditional (hook order); only its args become "skip" — while
  // `me` is still unresolved: either loading (undefined) or a Clerk session whose
  // users row isn't provisioned yet (null, the post-signup race on the join CTA
  // path — querying byId then would flood requireMember errors) — and permanently
  // on the self path, which redirects to /profile instead of rendering.
  const { data: member } = useQuery(
    convexQuery(
      gateway.identity.byId,
      !me || me._id === memberId ? "skip" : { userId: memberId },
    ),
  );

  // Publish the shell page head for the authed full-profile surface: the member's
  // display name as the leaf title under a Community › Members trail. The marketing
  // shell (signed-out) path doesn't mount the page-header slot, so this is scoped to
  // AuthedMemberPage. Hook stays above the early returns (hook order).
  usePageHeader(
    () => ({
      title: teaser.displayName,
      crumbs: [
        { label: tShell("groups.community.label"), href: "/community" },
        { label: tShell("pages.members.title"), href: "/people" },
      ],
      activeNavKey: "people",
    }),
    [teaser.displayName, tShell],
  );

  // `me` unresolved -> loading OR the post-signup provisioning race (null): both
  // render pending (byId is skipped, so `member` stays undefined and resolves once
  // `me` does); neither hangs.
  if (!me) {
    return <MemberPending />;
  }
  // Own handle -> the single own-profile surface. Client-side (unlike the
  // loader's canonical username redirect): self-detection needs the authed
  // currentUser, which the public unauthenticated SSR loader doesn't have.
  if (me._id === memberId) {
    return <Navigate to="/profile" replace />;
  }
  if (member === undefined) {
    return <MemberPending />;
  }
  if (member === null) {
    return <PrivateInterstitial teaser={teaser} />;
  }
  return <MemberProfileView member={member} />;
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
    <div className="mk-root font-mk-sans min-h-screen overflow-x-clip">
      <MarketingHeader />
      <main>{body}</main>
      <MarketingFooter />
    </div>
  );
}
