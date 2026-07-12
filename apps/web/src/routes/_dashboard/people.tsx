import { pageTitle } from "@/lib/page-title";
import { safeStorage } from "@/lib/safe-storage";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";

import { EmptyState } from "@/components/community/primitives";
import { SectionHead } from "@/components/dashboard-home/section-head";
import { usePageHeaderActions } from "@/components/dashboard-layout/page-header-slot";
import { ActivityFeed } from "@/components/social/activity-feed";
import { FindPeople } from "@/components/social/find-people";
import { FollowRequestsStrip } from "@/components/social/follow-requests-strip";
import {
  MemberTile,
  MemberTileSkeleton,
} from "@/components/social/member-tile";
import { QrDialog } from "@/components/social/qr-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  TAB_TRIGGER_CLASS,
  TabCount,
  UNDERLINE_TABS_LIST_CLASS,
} from "@/components/ui/underline-tabs";
import { gateway, Id } from "@/gateway";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Bell, Search, Users, X } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { useTranslations } from "use-intl";

type PeopleTab = "network" | "find" | "activity";

export const Route = createFileRoute("/_dashboard/people")({
  // URL-addressable tabs: /people?tab=find deep-links straight into discovery
  // (used by notifications and QR empty states). `tab` is optional so the
  // default (network) keeps a clean /people URL and existing bare `to="/people"`
  // links stay valid — the UI falls back to "network" when it's absent.
  validateSearch: (
    search: Record<string, unknown>,
  ): { tab?: "find" | "activity" } => ({
    tab:
      search.tab === "find" || search.tab === "activity"
        ? search.tab
        : undefined,
  }),
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "people") }],
  }),
  component: PeoplePage,
});

// ---------------------------------------------------------------------------
// One-time discoverability notice
// Info-toned (not a warning): tells members the directory can now surface
// their (public-by-default) profile, with an inline path to the existing
// visibility setting. Dismissal persists via safeStorage (bare localStorage
// throws in private mode).
// ---------------------------------------------------------------------------
const NOTICE_KEY = "jigswap.notice.discoverable";

// Read the dismissal flag through useSyncExternalStore rather than an effect:
// the server snapshot is "dismissed" (banner hidden), so SSR and the hydration
// pass agree (no mismatch, no flash for a returning user), and the client
// snapshot reads the real flag right after hydration. Reading storage in an
// effect + setState would trip react-hooks/set-state-in-effect and re-render.
const noopSubscribe = () => () => {};

function DiscoverabilityNotice() {
  const t = useTranslations("people.discoverableNotice");

  const dismissedInStorage = useSyncExternalStore(
    noopSubscribe,
    () => safeStorage.getItem("local", NOTICE_KEY) === "1",
    () => true,
  );
  const [dismissedNow, setDismissedNow] = useState(false);

  if (dismissedInStorage || dismissedNow) return null;

  const handleDismiss = () => {
    safeStorage.setItem("local", NOTICE_KEY, "1");
    setDismissedNow(true);
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="border-border bg-muted/60 text-muted-foreground flex items-start gap-3 rounded-lg border px-4 py-3 text-sm"
    >
      <span className="flex-1">
        {t("body")}{" "}
        <Link
          to="/profile"
          className="text-foreground font-medium underline underline-offset-2"
        >
          {t("review")}
        </Link>
      </span>
      <button
        type="button"
        aria-label={t("dismiss")}
        onClick={handleDismiss}
        className="hover:bg-accent hover:text-foreground focus-visible:ring-ring shrink-0 rounded p-0.5 focus-visible:ring-2 focus-visible:outline-none"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

// Your-network tab body: the pending follow-request strip above the deduped
// follower/following grid — the pre-tabs page content. The network is computed
// by the parent (which also publishes the count into the page header) and
// passed down, so the count and grid stay in sync without duplicating the
// follow queries.
function NetworkTab({
  members,
  loading,
}: {
  members: Array<[string, { followsYou: boolean }]>;
  loading: boolean;
}) {
  const t = useTranslations("people");

  return (
    <section className="flex flex-col gap-4">
      <FollowRequestsStrip />
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
  );
}

// Activity tab body: its own top-level tab (promoted out of NetworkTab so the
// activity feed isn't buried under the network grid, and so the misplaced
// profile-edit action that used to sit on this SectionHead is gone for good —
// profile editing lives on /profile).
function ActivityTab() {
  const t = useTranslations("people");

  return (
    <section>
      <SectionHead title={t("activity")} icon={Bell} />
      <ActivityFeed />
    </section>
  );
}

function PeoplePage() {
  const t = useTranslations("people");
  const { tab } = Route.useSearch();
  const activeTab: PeopleTab = tab ?? "network";
  const navigate = useNavigate({ from: Route.fullPath });

  const { data: following } = useQuery(
    convexQuery(gateway.social.following, {}),
  );
  const { data: followers } = useQuery(
    convexQuery(gateway.social.followers, {}),
  );
  const { data: me } = useQuery(convexQuery(gateway.identity.currentUser, {}));

  // Incoming pending follow requests drive the count badge on the network tab.
  const { data: incoming } = useQuery(
    convexQuery(gateway.social.incomingFollowRequests, {}),
  );
  const pendingCount = incoming?.length ?? 0;

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

  // The page title ("People") lives in the shell page head; publish the QR
  // dialog (self-service invite/QR) and the network member count there so the
  // body carries no duplicate header. Kept in the always-mounted page so the
  // header stays stable across tab switches.
  const headerMeta = loading
    ? undefined
    : t("memberCount", { count: members.length });
  usePageHeaderActions(
    () => (
      <div className="flex items-center gap-3">
        {me ? (
          <QrDialog
            memberId={me._id}
            displayName={me.name}
            username={me.username}
            avatarUrl={me.avatar}
          />
        ) : null}
        {headerMeta ? (
          <span className="text-muted-foreground hidden text-sm sm:inline">
            {headerMeta}
          </span>
        ) : null}
      </div>
    ),
    [headerMeta, me],
  );

  const handleTabChange = (value: string) => {
    void navigate({
      search: {
        tab: value === "find" || value === "activity" ? value : undefined,
      },
      replace: true,
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <DiscoverabilityNotice />

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className={UNDERLINE_TABS_LIST_CLASS}>
          <TabsTrigger value="network" className={TAB_TRIGGER_CLASS}>
            <Users aria-hidden />
            {t("tabs.network")}
            <TabCount count={pendingCount > 0 ? pendingCount : undefined} />
          </TabsTrigger>
          <TabsTrigger value="find" className={TAB_TRIGGER_CLASS}>
            <Search aria-hidden />
            {t("tabs.find")}
          </TabsTrigger>
          <TabsTrigger value="activity" className={TAB_TRIGGER_CLASS}>
            <Bell aria-hidden />
            {t("tabs.activity")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="network" className="mt-4">
          <NetworkTab members={members} loading={loading} />
        </TabsContent>
        <TabsContent value="find" className="mt-4">
          <FindPeople />
        </TabsContent>
        <TabsContent value="activity" className="mt-4">
          <ActivityTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
