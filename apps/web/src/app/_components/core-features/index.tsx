"use client";

import { BarChart3, Puzzle, Recycle, Users } from "lucide-react";
import { useTranslations } from "next-intl";

export function CoreFeatures() {
  const t = useTranslations();

  return (
    <section className="py-20 px-4">
      <div className="container mx-auto">
        <h2 className="text-3xl font-bold text-center mb-12">
          {t("features.core.title")}
        </h2>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
          <div className="text-center">
            <div className="w-16 h-16 bg-jigsaw-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <Puzzle className="h-8 w-8 text-jigsaw-primary" />
            </div>
            <h3 className="text-xl font-semibold mb-2">
              {t("features.core.personalLibrary.title")}
            </h3>
            <p className="text-muted-foreground text-sm">
              {t("features.core.personalLibrary.description")}
            </p>
          </div>
          <div className="text-center">
            <div className="w-16 h-16 bg-jigsaw-secondary/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <Recycle className="h-8 w-8 text-jigsaw-secondary" />
            </div>
            <h3 className="text-xl font-semibold mb-2">
              {t("features.core.smartExchange.title")}
            </h3>
            <p className="text-muted-foreground text-sm">
              {t("features.core.smartExchange.description")}
            </p>
          </div>
          <div className="text-center">
            <div className="w-16 h-16 bg-jigsaw-success/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <Users className="h-8 w-8 text-jigsaw-success" />
            </div>
            <h3 className="text-xl font-semibold mb-2">
              {t("features.core.community.title")}
            </h3>
            <p className="text-muted-foreground text-sm">
              {t("features.core.community.description")}
            </p>
          </div>
          <div className="text-center">
            <div className="w-16 h-16 bg-jigsaw-warning/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <BarChart3 className="h-8 w-8 text-jigsaw-warning" />
            </div>
            <h3 className="text-xl font-semibold mb-2">
              {t("features.core.analytics.title")}
            </h3>
            <p className="text-muted-foreground text-sm">
              {t("features.core.analytics.description")}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
