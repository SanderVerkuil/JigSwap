import { CirclePage } from "@/components/circles/circle-page";
import { AppNotFound } from "@/components/NotFound";
import { PageLoading } from "@/components/ui/loading";
import { pageTitle } from "@/lib/page-title";
import {
  createFileRoute,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { ConvexError } from "convex/values";
import { useTranslations } from "use-intl";

// A circle's member-gated reads refuse a non-member with CircleNotFound (getCircle returns null,
// which the page renders as the same 404). Render the refusal as the in-shell 404 too and rethrow
// anything else to the default catch boundary.
function CircleError({ error }: ErrorComponentProps) {
  if (error instanceof ConvexError) {
    const code = (error.data as { code?: unknown } | undefined)?.code;
    if (code === "CircleNotFound") return <AppNotFound />;
  }
  throw error;
}

export const Route = createFileRoute("/_dashboard/circles/$circleId")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "circles") }],
  }),
  pendingComponent: () => <CirclePending />,
  errorComponent: CircleError,
  component: CircleRoute,
});

function CirclePending() {
  const t = useTranslations("circles");
  return <PageLoading message={t("manage.loadingCircle")} />;
}

function CircleRoute() {
  const { circleId } = Route.useParams();
  return <CirclePage circleId={circleId} />;
}
