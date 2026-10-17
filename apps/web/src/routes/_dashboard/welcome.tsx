import { CataloguePicker } from "@/components/catalogue-picker/catalogue-picker";
import { useCurrentMember } from "@/components/dashboard-home/use-current-member";
import {
  QuickStartDonePanel,
  QuickStartFlowView,
} from "@/components/quick-start/flow-view";
import { HouseholdStep } from "@/components/quick-start/household-step";
import {
  nextFlowStep,
  parseFlowStep,
  resolveFlowStep,
  type FlowStep,
} from "@/components/quick-start/logic";
import { PeopleStep } from "@/components/quick-start/people-step";
import { ProfileStep } from "@/components/quick-start/profile-step";
import { useMarkQuickStartUsed } from "@/components/quick-start/session";
import { TourHandoffButton } from "@/components/quick-start/tour-handoff";
import { PastSolvesForm } from "@/components/solving/past-solves-form";
import { tourButtonState } from "@/components/tour/controller";
import { TOURS } from "@/components/tour/definitions";
import { Button } from "@/components/ui/button";
import { PageLoading } from "@/components/ui/loading";
import { useReportSurfaceBusy } from "@/components/whats-new/surface-busy";
import { useTourLauncher } from "@/components/whats-new/tour-launcher";
import { useWhatsNewState } from "@/components/whats-new/use-whats-new-state";
import { gateway } from "@/gateway";
import { pageTitle } from "@/lib/page-title";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import type { QuickStartStepId, QuickStartView } from "@jigswap/contracts";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslations } from "use-intl";

// The quick start flow (spec §2.2): one URL per step, so the browser back button walks back
// through them. A missing or unknown step resolves to the first open required step. Skip
// stores the skip; Continue stores nothing (done-ness is derived from data). No dialogs inside
// the flow, and the What's new highlight never opens here.
export const Route = createFileRoute("/_dashboard/welcome")({
  validateSearch: (search: Record<string, unknown>): { step?: FlowStep } => ({
    step: parseFlowStep(search.step),
  }),
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "quickSetup") }],
  }),
  component: WelcomePage,
});

function WelcomePage() {
  const { step: requested } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { member } = useCurrentMember();
  const { data: view } = useQuery(
    convexQuery(gateway.onboarding.quickStart, member ? {} : "skip"),
  );
  const record = useConvexMutation(gateway.onboarding.recordQuickStart);
  const tCommon = useTranslations("common");
  useReportSurfaceBusy("quickstart", true);
  useMarkQuickStartUsed(true);
  // Funnel fact for the activation report: the member opened the flow. Stored once server-side.
  const memberId = member?._id;
  useEffect(() => {
    if (!memberId) return;
    record({ kind: "startQuickStart" }).catch((error: unknown) =>
      console.error("Failed to record the quick start start:", error),
    );
  }, [memberId, record]);

  const step = resolveFlowStep(requested, view);
  if (!step || !view) return <PageLoading message={tCommon("loading")} />;

  if (step === "done") {
    return <QuickStartDonePanel view={view} tourAction={<TourHandoff />} />;
  }

  const go = (next: FlowStep) => void navigate({ search: { step: next } });
  const skip = () => {
    record({ kind: "skipStep", step }).catch((error: unknown) =>
      console.error("Failed to skip the step:", error),
    );
    go(nextFlowStep(step));
  };

  return (
    <QuickStartFlowView
      step={step}
      view={view}
      onSkip={skip}
      onContinue={() => go(nextFlowStep(step))}
    >
      <StepBody step={step} view={view} onSkip={skip} />
    </QuickStartFlowView>
  );
}

function StepBody({
  step,
  view,
  onSkip,
}: {
  step: QuickStartStepId;
  view: QuickStartView;
  onSkip: () => void;
}) {
  const t = useTranslations("quickStart.steps");
  switch (step) {
    case "puzzles":
      return <CataloguePicker returnTo="/welcome?step=puzzles" />;
    case "solves":
      return (
        <PastSolvesForm
          emptyAction={
            <Button
              asChild
              variant="outline"
              className="pointer-coarse:min-h-11"
            >
              <Link to="/welcome" search={{ step: "puzzles" }}>
                {t("puzzles.title")}
              </Link>
            </Button>
          }
        />
      );
    case "people":
      return (
        <PeopleStep
          status={view.steps.find((s) => s.id === "people")?.status ?? "todo"}
        />
      );
    case "household":
      return <HouseholdStep onAlone={onSkip} />;
    case "profile":
      return <ProfileStep />;
  }
}

const HANDOFF_TOUR = "getting-started";

// "Show me around" (spec §2.8): the standalone getting-started tour through the shared runner,
// resuming at the saved step when it was paused.
function TourHandoff() {
  const { startTour } = useTourLauncher();
  const { tours } = useWhatsNewState();
  const state = tourButtonState(
    tours?.find((p) => p.tourId === HANDOFF_TOUR),
    TOURS.get(HANDOFF_TOUR)?.steps.length ?? 0,
  );
  return (
    <TourHandoffButton
      state={state}
      onStart={(returnFocus) => startTour(HANDOFF_TOUR, { returnFocus })}
    />
  );
}
