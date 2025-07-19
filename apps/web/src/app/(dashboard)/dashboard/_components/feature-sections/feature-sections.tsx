"use client";

import { CommunitySection } from "./community-section";
import { PersonalLibrarySection } from "./personal-library-section";

export function FeatureSections() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <PersonalLibrarySection />
      <CommunitySection />
    </div>
  );
}
