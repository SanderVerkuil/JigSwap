"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTranslations } from "next-intl";

export function ComingSoon() {
  const t = useTranslations();
  return (
    <section className="container mx-auto px-4 py-20">
      <Card>
        <CardHeader>
          <CardTitle>{t("home.comingSoon.title")}</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground space-y-2">
          <ul className="list-disc pl-5 space-y-1">
            <li>{t("home.comingSoon.items.completionTracking")}</li>
            <li>{t("home.comingSoon.items.availabilityControls")}</li>
            <li>{t("home.comingSoon.items.sharingRules")}</li>
            <li>{t("home.comingSoon.items.friendCircles")}</li>
            <li>{t("home.comingSoon.items.advancedDiscovery")}</li>
          </ul>
          <p className="pt-2">{t("home.comingSoon.specsNote")}</p>
        </CardContent>
      </Card>
    </section>
  );
}
