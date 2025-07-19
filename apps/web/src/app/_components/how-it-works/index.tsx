"use client";

import { useTranslations } from "next-intl";

export function HowItWorks() {
  const t = useTranslations();

  return (
    <section className="py-20 px-4 bg-muted/50">
      <div className="container mx-auto">
        <h2 className="text-3xl font-bold text-center mb-12">
          {t("steps.howItWorks.title")}
        </h2>
        <div className="grid md:grid-cols-4 gap-8">
          <div className="text-center">
            <div className="w-12 h-12 bg-jigsaw-primary text-white rounded-full flex items-center justify-center mx-auto mb-4 text-xl font-bold">
              1
            </div>
            <h3 className="text-lg font-semibold mb-2">
              {t("steps.howItWorks.buildLibrary.title")}
            </h3>
            <p className="text-muted-foreground text-sm">
              {t("steps.howItWorks.buildLibrary.description")}
            </p>
          </div>
          <div className="text-center">
            <div className="w-12 h-12 bg-jigsaw-primary text-white rounded-full flex items-center justify-center mx-auto mb-4 text-xl font-bold">
              2
            </div>
            <h3 className="text-lg font-semibold mb-2">
              {t("steps.howItWorks.discoverConnect.title")}
            </h3>
            <p className="text-muted-foreground text-sm">
              {t("steps.howItWorks.discoverConnect.description")}
            </p>
          </div>
          <div className="text-center">
            <div className="w-12 h-12 bg-jigsaw-primary text-white rounded-full flex items-center justify-center mx-auto mb-4 text-xl font-bold">
              3
            </div>
            <h3 className="text-lg font-semibold mb-2">
              {t("steps.howItWorks.exchangeTrade.title")}
            </h3>
            <p className="text-muted-foreground text-sm">
              {t("steps.howItWorks.exchangeTrade.description")}
            </p>
          </div>
          <div className="text-center">
            <div className="w-12 h-12 bg-jigsaw-primary text-white rounded-full flex items-center justify-center mx-auto mb-4 text-xl font-bold">
              4
            </div>
            <h3 className="text-lg font-semibold mb-2">
              {t("steps.howItWorks.analyzeImprove.title")}
            </h3>
            <p className="text-muted-foreground text-sm">
              {t("steps.howItWorks.analyzeImprove.description")}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
