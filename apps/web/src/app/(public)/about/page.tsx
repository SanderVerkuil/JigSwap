"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";

export default function AboutPage() {
  const tCommon = useTranslations("common");
  const t = useTranslations("about");

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto max-w-4xl">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-foreground mb-2">
            {t("title")}
          </h1>
          <p className="text-xl text-muted-foreground mb-4">{t("subtitle")}</p>
          <div className="flex items-center gap-4 text-muted-foreground text-sm">
            <Link href="/" className="hover:text-foreground">
              {tCommon("backToHome")}
            </Link>
          </div>
        </div>

        {/* Introduction */}
        <section className="mb-12">
          <p className="text-lg text-muted-foreground leading-relaxed">
            {t("introduction")}
          </p>
        </section>

        {/* Mission */}
        <section className="mb-12">
          <h2 className="text-3xl font-semibold text-foreground mb-6">
            {t("mission.title")}
          </h2>
          <p className="text-lg text-muted-foreground leading-relaxed">
            {t("mission.description")}
          </p>
        </section>

        {/* Vision */}
        <section className="mb-12">
          <h2 className="text-3xl font-semibold text-foreground mb-6">
            {t("vision.title")}
          </h2>
          <p className="text-lg text-muted-foreground leading-relaxed">
            {t("vision.description")}
          </p>
        </section>

        {/* Values */}
        <section className="mb-12">
          <h2 className="text-3xl font-semibold text-foreground mb-6">
            {t("values.title")}
          </h2>
          <div className="grid md:grid-cols-2 gap-6">
            <div className="bg-muted/50 p-6 rounded-lg">
              <h3 className="text-xl font-medium text-foreground mb-3">
                {t("values.sustainability.title")}
              </h3>
              <p className="text-muted-foreground">
                {t("values.sustainability.description")}
              </p>
            </div>
            <div className="bg-muted/50 p-6 rounded-lg">
              <h3 className="text-xl font-medium text-foreground mb-3">
                {t("values.community.title")}
              </h3>
              <p className="text-muted-foreground">
                {t("values.community.description")}
              </p>
            </div>
            <div className="bg-muted/50 p-6 rounded-lg">
              <h3 className="text-xl font-medium text-foreground mb-3">
                {t("values.transparency.title")}
              </h3>
              <p className="text-muted-foreground">
                {t("values.transparency.description")}
              </p>
            </div>
            <div className="bg-muted/50 p-6 rounded-lg">
              <h3 className="text-xl font-medium text-foreground mb-3">
                {t("values.accessibility.title")}
              </h3>
              <p className="text-muted-foreground">
                {t("values.accessibility.description")}
              </p>
            </div>
          </div>
        </section>

        {/* Story */}
        <section className="mb-12">
          <h2 className="text-3xl font-semibold text-foreground mb-6">
            {t("story.title")}
          </h2>
          <div className="space-y-6">
            <p className="text-lg text-muted-foreground leading-relaxed">
              {t("story.description")}
            </p>
            <p className="text-lg text-muted-foreground leading-relaxed">
              {t("story.founded")}
            </p>
          </div>
        </section>

        {/* Team */}
        <section className="mb-12">
          <h2 className="text-3xl font-semibold text-foreground mb-6">
            {t("team.title")}
          </h2>
          <div className="space-y-6">
            <p className="text-lg text-muted-foreground leading-relaxed">
              {t("team.description")}
            </p>
            <p className="text-lg text-muted-foreground leading-relaxed">
              {t("team.passion")}
            </p>
          </div>
        </section>

        {/* Technology */}
        <section className="mb-12">
          <h2 className="text-3xl font-semibold text-foreground mb-6">
            {t("technology.title")}
          </h2>
          <p className="text-lg text-muted-foreground mb-6 leading-relaxed">
            {t("technology.description")}
          </p>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
            {t
              .raw("technology.features")
              .map((feature: string, index: number) => (
                <li key={index} className="text-lg">
                  {feature}
                </li>
              ))}
          </ul>
        </section>

        {/* Community */}
        <section className="mb-12">
          <h2 className="text-3xl font-semibold text-foreground mb-6">
            {t("community.title")}
          </h2>
          <div className="space-y-6">
            <p className="text-lg text-muted-foreground leading-relaxed">
              {t("community.description")}
            </p>
            <p className="text-lg text-muted-foreground leading-relaxed">
              {t("community.getStarted")}
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
