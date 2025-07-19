"use client";

import { AdvancedFeaturesSection } from "./_components/feature-sections/advanced-features-section";
import { FeatureSections } from "./_components/feature-sections/feature-sections";
import { QuickActionsSection } from "./_components/quick-actions/quick-actions-section";
import { RecentActivitySection } from "./_components/recent-activity/recent-activity-section";
import { WelcomeHeader } from "./_components/welcome-section/welcome-header";

export default function DashboardPage() {
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
