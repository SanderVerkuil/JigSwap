"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";

export default function PrivacyPolicyPage() {
  const t = useTranslations("privacy");
  const tCommon = useTranslations("common");
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto max-w-4xl">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-foreground mb-4">
            {t("title")}
          </h1>
          <div className="flex items-center gap-4 text-muted-foreground text-sm">
            <span>
              {t("lastUpdated")}: {t("effectiveDate")}
            </span>
            <span>•</span>
            <Link href="/" className="hover:text-foreground">
              {tCommon("backToHome")}
            </Link>
          </div>
        </div>

        {/* Introduction */}
        <section className="mb-8">
          <p className="text-lg text-muted-foreground leading-relaxed">
            {t("introduction")}
          </p>
        </section>

        {/* Information We Collect */}
        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-foreground mb-4">
            {t("informationWeCollect.title")}
          </h2>
          <p className="text-muted-foreground mb-6">
            {t("informationWeCollect.description")}
          </p>

          <div className="space-y-6">
            <div>
              <h3 className="text-xl font-medium text-foreground mb-3">
                {t("informationWeCollect.personalInformation.title")}
              </h3>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                {t
                  .raw("informationWeCollect.personalInformation.items")
                  .map((item: string, index: number) => (
                    <li key={index}>{item}</li>
                  ))}
              </ul>
            </div>

            <div>
              <h3 className="text-xl font-medium text-foreground mb-3">
                {t("informationWeCollect.automaticallyCollected.title")}
              </h3>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                {t
                  .raw("informationWeCollect.automaticallyCollected.items")
                  .map((item: string, index: number) => (
                    <li key={index}>{item}</li>
                  ))}
              </ul>
            </div>
          </div>
        </section>

        {/* How We Use Information */}
        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-foreground mb-4">
            {t("howWeUseInformation.title")}
          </h2>
          <p className="text-muted-foreground mb-6">
            {t("howWeUseInformation.description")}
          </p>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
            {t
              .raw("howWeUseInformation.purposes")
              .map((purpose: string, index: number) => (
                <li key={index}>{purpose}</li>
              ))}
          </ul>
        </section>

        {/* Data Storage */}
        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-foreground mb-4">
            {t("dataStorage.title")}
          </h2>
          <p className="text-muted-foreground mb-6">
            {t("dataStorage.description")}
          </p>

          <div className="space-y-6">
            <div className="bg-muted/50 p-6 rounded-lg">
              <h3 className="text-xl font-medium text-foreground mb-3">
                {t("dataStorage.convex.title")}
              </h3>
              <p className="text-muted-foreground">
                {t("dataStorage.convex.description")}
              </p>
            </div>

            <div className="bg-muted/50 p-6 rounded-lg">
              <h3 className="text-xl font-medium text-foreground mb-3">
                {t("dataStorage.vercel.title")}
              </h3>
              <p className="text-muted-foreground">
                {t("dataStorage.vercel.description")}
              </p>
            </div>
          </div>
        </section>

        {/* Analytics */}
        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-foreground mb-4">
            {t("analytics.title")}
          </h2>
          <p className="text-muted-foreground mb-6">
            {t("analytics.description")}
          </p>

          <div className="bg-muted/50 p-6 rounded-lg mb-6">
            <h3 className="text-xl font-medium text-foreground mb-3">
              {t("analytics.posthog.title")}
            </h3>
            <p className="text-muted-foreground mb-4">
              {t("analytics.posthog.description")}
            </p>
            <p className="text-muted-foreground font-medium">
              {t("analytics.noAdvertising")}
            </p>
          </div>
        </section>

        {/* Data Sharing */}
        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-foreground mb-4">
            {t("dataSharing.title")}
          </h2>
          <p className="text-muted-foreground mb-4">
            {t("dataSharing.description")}
          </p>
          <p className="text-muted-foreground mb-6 font-medium">
            {t("dataSharing.noSale")}
          </p>
          <p className="text-muted-foreground mb-4">
            {t("dataSharing.limitedSharing")}
          </p>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
            {t
              .raw("dataSharing.circumstances")
              .map((circumstance: string, index: number) => (
                <li key={index}>{circumstance}</li>
              ))}
          </ul>
        </section>

        {/* Data Security */}
        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-foreground mb-4">
            {t("dataSecurity.title")}
          </h2>
          <p className="text-muted-foreground mb-6">
            {t("dataSecurity.description")}
          </p>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
            {t
              .raw("dataSecurity.measures")
              .map((measure: string, index: number) => (
                <li key={index}>{measure}</li>
              ))}
          </ul>
        </section>

        {/* Your Rights */}
        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-foreground mb-4">
            {t("yourRights.title")}
          </h2>
          <p className="text-muted-foreground mb-6">
            {t("yourRights.description")}
          </p>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
            {t.raw("yourRights.rights").map((right: string, index: number) => (
              <li key={index}>{right}</li>
            ))}
          </ul>
        </section>

        {/* Cookies */}
        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-foreground mb-4">
            {t("cookies.title")}
          </h2>
          <p className="text-muted-foreground mb-6">
            {t("cookies.description")}
          </p>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4 mb-4">
            {t.raw("cookies.types").map((type: string, index: number) => (
              <li key={index}>{type}</li>
            ))}
          </ul>
          <p className="text-muted-foreground">{t("cookies.control")}</p>
        </section>

        {/* Children's Privacy */}
        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-foreground mb-4">
            {t("children.title")}
          </h2>
          <p className="text-muted-foreground">{t("children.description")}</p>
        </section>

        {/* International Transfers */}
        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-foreground mb-4">
            {t("international.title")}
          </h2>
          <p className="text-muted-foreground">
            {t("international.description")}
          </p>
        </section>

        {/* Changes to Policy */}
        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-foreground mb-4">
            {t("changes.title")}
          </h2>
          <p className="text-muted-foreground">{t("changes.description")}</p>
        </section>

        {/* Contact */}
        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-foreground mb-4">
            {t("contact.title")}
          </h2>
          <p className="text-muted-foreground mb-4">
            {t("contact.description")}
          </p>
          <div className="bg-muted/50 p-6 rounded-lg">
            <p className="text-muted-foreground mb-2">
              <span className="font-medium">{t("contact.email")}:</span>{" "}
              <a
                href={`mailto:${t("contact.emailAddress")}`}
                className="text-primary hover:underline"
              >
                {t("contact.emailAddress")}
              </a>
            </p>
            <p className="text-muted-foreground">{t("contact.questions")}</p>
          </div>
        </section>

        {/* Footer */}
        <div className="border-t pt-8 mt-12">
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <Link href="/" className="hover:text-foreground">
              {tCommon("backToHome")}
            </Link>
            <span>
              {t("lastUpdated")}: {t("effectiveDate")}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
