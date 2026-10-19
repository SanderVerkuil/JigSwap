import { householdErrorKey } from "@/components/household/household-error";
import {
  HouseholdDetails,
  NoHousehold,
  type HouseholdTab,
} from "@/components/household/household-page";
import { PageLoading } from "@/components/ui/loading";
import { gateway } from "@/gateway";
import { pageTitle } from "@/lib/page-title";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

export const Route = createFileRoute("/_dashboard/household")({
  // URL-addressable tabs (/household?tab=members); Puzzles is the default and carries no param.
  // The old ?tab=puzzles (the viewer's own puzzles' access, now "sharing") lands on the default.
  validateSearch: (
    search: Record<string, unknown>,
  ): { tab?: "members" | "sharing" | "settings" } => ({
    tab:
      search.tab === "members" ||
      search.tab === "sharing" ||
      search.tab === "settings"
        ? search.tab
        : undefined,
  }),
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "household") }],
  }),
  pendingComponent: () => <HouseholdPending />,
  component: HouseholdPage,
});

function HouseholdPending() {
  const t = useTranslations("household");
  return <PageLoading message={t("loading")} />;
}

function HouseholdPage() {
  const t = useTranslations("household");
  const navigate = useNavigate({ from: Route.fullPath });
  const { tab } = Route.useSearch();

  const { data: household, isPending: householdPending } = useQuery(
    convexQuery(gateway.household.mine, {}),
  );
  const { data: invites } = useQuery(
    convexQuery(gateway.household.myInvites, {}),
  );

  const fail = (error: unknown) => toast.error(t(householdErrorKey(error)));

  if (householdPending || household === undefined) {
    return <PageLoading message={t("loading")} />;
  }

  if (household === null) {
    return <NoHousehold invites={invites ?? []} onError={fail} />;
  }

  const onTabChange = (next: HouseholdTab) =>
    void navigate({
      search: { tab: next === "puzzles" ? undefined : next },
      replace: true,
      // A tab switch is a view change on the same page, not a new page: keep the scroll position.
      resetScroll: false,
    });

  return (
    <HouseholdDetails
      household={household}
      invites={invites ?? []}
      activeTab={tab ?? "puzzles"}
      onTabChange={onTabChange}
      onError={fail}
    />
  );
}
