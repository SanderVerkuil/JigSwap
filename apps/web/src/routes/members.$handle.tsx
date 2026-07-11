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
  // head runs after the loader on the SSR pass, which is the pass crawlers
  // see — so the private-profile noindex is reliably in the served HTML.
  head: ({ loaderData }) => ({
    meta: [
      {
        title: loaderData?.teaser
          ? `${loaderData.teaser.displayName} — JigSwap`
          : "JigSwap",
      },
      ...(loaderData?.teaser?.visibility === "private"
        ? [{ name: "robots", content: "noindex" }]
        : []),
    ],
  }),
  pendingComponent: () => <PageLoading message="Loading member..." />,
  notFoundComponent: MemberNotFound,
  component: MemberPage,
});

function MemberPage() {
  const { userId } = useRouteContext({ from: "__root__" });
  const { handle } = Route.useParams();
  const { invite } = Route.useSearch();
  const { data: teaser } = useQuery(
    convexQuery(gateway.social.publicMemberTeaser, { handle }),
  );

  if (!teaser) return <PageLoading message="Loading member..." />;

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
  const { data: me } = useQuery(convexQuery(gateway.identity.currentUser, {}));
  // Privacy-gated tier discriminator: getUserById returns null for a private
  // non-mutual target (and only then, for an existing active member).
  const { data: member } = useQuery(
    convexQuery(gateway.identity.byId, { userId: memberId }),
  );

  if (me === undefined || member === undefined) {
    return <PageLoading message="Loading member..." />;
  }
  // Own handle -> the single own-profile surface.
  if (me && me._id === memberId) {
    return <Navigate to="/profile" replace />;
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
  if (userId) return body;
  return (
    <div className="mk-root font-mk-sans min-h-screen overflow-x-clip">
      <MarketingHeader />
      <main>{body}</main>
      <MarketingFooter />
    </div>
  );
}
