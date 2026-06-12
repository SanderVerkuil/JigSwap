import { pageTitle } from "@/lib/page-title";
import { createFileRoute } from "@tanstack/react-router";

import { AdvancedFeaturesSection } from "@/components/dashboard-home/feature-sections/advanced-features-section";
import { FeatureSections } from "@/components/dashboard-home/feature-sections/feature-sections";
import { QuickActionsSection } from "@/components/dashboard-home/quick-actions/quick-actions-section";
import { RecentActivitySection } from "@/components/dashboard-home/recent-activity/recent-activity-section";
import { WelcomeHeader } from "@/components/dashboard-home/welcome-section/welcome-header";

// The (dashboard) landing (URL: /dashboard). Replaces the part-1 placeholder anchor child of the
// _dashboard pathless layout with the real welcome / quick-actions / feature-sections /
// recent-activity composition ported from the Next dashboard page.
export const Route = createFileRoute("/_dashboard/dashboard")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "dashboard") }],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  return (
    <div className="space-y-6">
      <WelcomeHeader />
      <QuickActionsSection />
      <FeatureSections />
      <AdvancedFeaturesSection />
      <RecentActivitySection />
    </div>
  );
}
