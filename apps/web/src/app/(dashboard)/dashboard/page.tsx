'use client';

import { WelcomeHeader } from './_components/welcome-section/welcome-header';
import { QuickActionsSection } from './_components/quick-actions/quick-actions-section';
import { FeatureSections } from './_components/feature-sections/feature-sections';
import { AdvancedFeaturesSection } from './_components/feature-sections/advanced-features-section';
import { RecentActivitySection } from './_components/recent-activity/recent-activity-section';

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
