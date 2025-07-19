"use client";

import { useTranslations } from "next-intl";

export function DetailedFeatures() {
  const t = useTranslations();

  return (
    <section className="py-20 px-4">
      <div className="container mx-auto">
        <h2 className="text-3xl font-bold text-center mb-12">
          {t("features.detailed.title")}
        </h2>

        {/* Personal Library Features */}
        <div className="mb-16">
          <h3 className="text-2xl font-semibold mb-6 text-center">
            {t("features.detailed.personalLibrary.title")}
          </h3>
          <div className="grid md:grid-cols-3 gap-6">
            <div className="bg-card p-6 rounded-lg border">
              <h4 className="font-semibold mb-3">
                {t(
                  "features.detailed.personalLibrary.collectionManagement.title",
                )}
              </h4>
              <ul className="text-sm text-muted-foreground space-y-2">
                <li>
                  •{" "}
                  {t(
                    "features.detailed.personalLibrary.collectionManagement.items.0",
                  )}
                </li>
                <li>
                  •{" "}
                  {t(
                    "features.detailed.personalLibrary.collectionManagement.items.1",
                  )}
                </li>
                <li>
                  •{" "}
                  {t(
                    "features.detailed.personalLibrary.collectionManagement.items.2",
                  )}
                </li>
                <li>
                  •{" "}
                  {t(
                    "features.detailed.personalLibrary.collectionManagement.items.3",
                  )}
                </li>
              </ul>
            </div>
            <div className="bg-card p-6 rounded-lg border">
              <h4 className="font-semibold mb-3">
                {t(
                  "features.detailed.personalLibrary.completionTracking.title",
                )}
              </h4>
              <ul className="text-sm text-muted-foreground space-y-2">
                <li>
                  •{" "}
                  {t(
                    "features.detailed.personalLibrary.completionTracking.items.0",
                  )}
                </li>
                <li>
                  •{" "}
                  {t(
                    "features.detailed.personalLibrary.completionTracking.items.1",
                  )}
                </li>
                <li>
                  •{" "}
                  {t(
                    "features.detailed.personalLibrary.completionTracking.items.2",
                  )}
                </li>
                <li>
                  •{" "}
                  {t(
                    "features.detailed.personalLibrary.completionTracking.items.3",
                  )}
                </li>
              </ul>
            </div>
            <div className="bg-card p-6 rounded-lg border">
              <h4 className="font-semibold mb-3">
                {t("features.detailed.personalLibrary.personalAnalytics.title")}
              </h4>
              <ul className="text-sm text-muted-foreground space-y-2">
                <li>
                  •{" "}
                  {t(
                    "features.detailed.personalLibrary.personalAnalytics.items.0",
                  )}
                </li>
                <li>
                  •{" "}
                  {t(
                    "features.detailed.personalLibrary.personalAnalytics.items.1",
                  )}
                </li>
                <li>
                  •{" "}
                  {t(
                    "features.detailed.personalLibrary.personalAnalytics.items.2",
                  )}
                </li>
                <li>
                  •{" "}
                  {t(
                    "features.detailed.personalLibrary.personalAnalytics.items.3",
                  )}
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* Exchange System Features */}
        <div className="mb-16">
          <h3 className="text-2xl font-semibold mb-6 text-center">
            {t("features.detailed.exchangeSystem.title")}
          </h3>
          <div className="grid md:grid-cols-3 gap-6">
            <div className="bg-card p-6 rounded-lg border">
              <h4 className="font-semibold mb-3">
                {t(
                  "features.detailed.exchangeSystem.multipleExchangeTypes.title",
                )}
              </h4>
              <ul className="text-sm text-muted-foreground space-y-2">
                <li>
                  •{" "}
                  {t(
                    "features.detailed.exchangeSystem.multipleExchangeTypes.items.0",
                  )}
                </li>
                <li>
                  •{" "}
                  {t(
                    "features.detailed.exchangeSystem.multipleExchangeTypes.items.1",
                  )}
                </li>
                <li>
                  •{" "}
                  {t(
                    "features.detailed.exchangeSystem.multipleExchangeTypes.items.2",
                  )}
                </li>
                <li>
                  •{" "}
                  {t(
                    "features.detailed.exchangeSystem.multipleExchangeTypes.items.3",
                  )}
                </li>
              </ul>
            </div>
            <div className="bg-card p-6 rounded-lg border">
              <h4 className="font-semibold mb-3">
                {t(
                  "features.detailed.exchangeSystem.historyPreservation.title",
                )}
              </h4>
              <ul className="text-sm text-muted-foreground space-y-2">
                <li>
                  •{" "}
                  {t(
                    "features.detailed.exchangeSystem.historyPreservation.items.0",
                  )}
                </li>
                <li>
                  •{" "}
                  {t(
                    "features.detailed.exchangeSystem.historyPreservation.items.1",
                  )}
                </li>
                <li>
                  •{" "}
                  {t(
                    "features.detailed.exchangeSystem.historyPreservation.items.2",
                  )}
                </li>
                <li>
                  •{" "}
                  {t(
                    "features.detailed.exchangeSystem.historyPreservation.items.3",
                  )}
                </li>
              </ul>
            </div>
            <div className="bg-card p-6 rounded-lg border">
              <h4 className="font-semibold mb-3">
                {t("features.detailed.exchangeSystem.exchangeManagement.title")}
              </h4>
              <ul className="text-sm text-muted-foreground space-y-2">
                <li>
                  •{" "}
                  {t(
                    "features.detailed.exchangeSystem.exchangeManagement.items.0",
                  )}
                </li>
                <li>
                  •{" "}
                  {t(
                    "features.detailed.exchangeSystem.exchangeManagement.items.1",
                  )}
                </li>
                <li>
                  •{" "}
                  {t(
                    "features.detailed.exchangeSystem.exchangeManagement.items.2",
                  )}
                </li>
                <li>
                  •{" "}
                  {t(
                    "features.detailed.exchangeSystem.exchangeManagement.items.3",
                  )}
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* Community Features */}
        <div className="mb-16">
          <h3 className="text-2xl font-semibold mb-6 text-center">
            {t("features.detailed.community.title")}
          </h3>
          <div className="grid md:grid-cols-3 gap-6">
            <div className="bg-card p-6 rounded-lg border">
              <h4 className="font-semibold mb-3">
                {t("features.detailed.community.userProfiles.title")}
              </h4>
              <ul className="text-sm text-muted-foreground space-y-2">
                <li>
                  • {t("features.detailed.community.userProfiles.items.0")}
                </li>
                <li>
                  • {t("features.detailed.community.userProfiles.items.1")}
                </li>
                <li>
                  • {t("features.detailed.community.userProfiles.items.2")}
                </li>
                <li>
                  • {t("features.detailed.community.userProfiles.items.3")}
                </li>
              </ul>
            </div>
            <div className="bg-card p-6 rounded-lg border">
              <h4 className="font-semibold mb-3">
                {t("features.detailed.community.reviewsRatings.title")}
              </h4>
              <ul className="text-sm text-muted-foreground space-y-2">
                <li>
                  • {t("features.detailed.community.reviewsRatings.items.0")}
                </li>
                <li>
                  • {t("features.detailed.community.reviewsRatings.items.1")}
                </li>
                <li>
                  • {t("features.detailed.community.reviewsRatings.items.2")}
                </li>
                <li>
                  • {t("features.detailed.community.reviewsRatings.items.3")}
                </li>
              </ul>
            </div>
            <div className="bg-card p-6 rounded-lg border">
              <h4 className="font-semibold mb-3">
                {t("features.detailed.community.socialDiscovery.title")}
              </h4>
              <ul className="text-sm text-muted-foreground space-y-2">
                <li>
                  • {t("features.detailed.community.socialDiscovery.items.0")}
                </li>
                <li>
                  • {t("features.detailed.community.socialDiscovery.items.1")}
                </li>
                <li>
                  • {t("features.detailed.community.socialDiscovery.items.2")}
                </li>
                <li>
                  • {t("features.detailed.community.socialDiscovery.items.3")}
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* Advanced Features */}
        <div className="mb-16">
          <h3 className="text-2xl font-semibold mb-6 text-center">
            {t("features.detailed.advanced.title")}
          </h3>
          <div className="grid md:grid-cols-3 gap-6">
            <div className="bg-card p-6 rounded-lg border">
              <h4 className="font-semibold mb-3">
                {t("features.detailed.advanced.conditionTracking.title")}
              </h4>
              <ul className="text-sm text-muted-foreground space-y-2">
                <li>
                  • {t("features.detailed.advanced.conditionTracking.items.0")}
                </li>
                <li>
                  • {t("features.detailed.advanced.conditionTracking.items.1")}
                </li>
                <li>
                  • {t("features.detailed.advanced.conditionTracking.items.2")}
                </li>
                <li>
                  • {t("features.detailed.advanced.conditionTracking.items.3")}
                </li>
              </ul>
            </div>
            <div className="bg-card p-6 rounded-lg border">
              <h4 className="font-semibold mb-3">
                {t("features.detailed.advanced.smartRecommendations.title")}
              </h4>
              <ul className="text-sm text-muted-foreground space-y-2">
                <li>
                  •{" "}
                  {t("features.detailed.advanced.smartRecommendations.items.0")}
                </li>
                <li>
                  •{" "}
                  {t("features.detailed.advanced.smartRecommendations.items.1")}
                </li>
                <li>
                  •{" "}
                  {t("features.detailed.advanced.smartRecommendations.items.2")}
                </li>
                <li>
                  •{" "}
                  {t("features.detailed.advanced.smartRecommendations.items.3")}
                </li>
              </ul>
            </div>
            <div className="bg-card p-6 rounded-lg border">
              <h4 className="font-semibold mb-3">
                {t("features.detailed.advanced.notificationSystem.title")}
              </h4>
              <ul className="text-sm text-muted-foreground space-y-2">
                <li>
                  • {t("features.detailed.advanced.notificationSystem.items.0")}
                </li>
                <li>
                  • {t("features.detailed.advanced.notificationSystem.items.1")}
                </li>
                <li>
                  • {t("features.detailed.advanced.notificationSystem.items.2")}
                </li>
                <li>
                  • {t("features.detailed.advanced.notificationSystem.items.3")}
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
