"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";

export default function TermsOfServicePage() {
  const t = useTranslations("terms");
  const tCommon = useTranslations("common");
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
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

        {/* Acceptance of Terms */}
        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-foreground mb-4">
            {t("acceptance.title")}
          </h2>
          <p className="text-muted-foreground">{t("acceptance.description")}</p>
        </section>

        {/* Service Description */}
        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-foreground mb-4">
            {t("serviceDescription.title")}
          </h2>
          <p className="text-muted-foreground mb-6">
            {t("serviceDescription.description")}
          </p>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
            {t
              .raw("serviceDescription.features")
              .map((feature: string, index: number) => (
                <li key={index}>{feature}</li>
              ))}
          </ul>
        </section>

        {/* User Accounts */}
        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-foreground mb-4">
            {t("userAccounts.title")}
          </h2>
          <p className="text-muted-foreground mb-6">
            {t("userAccounts.description")}
          </p>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
            {t
              .raw("userAccounts.responsibilities")
              .map((responsibility: string, index: number) => (
                <li key={index}>{responsibility}</li>
              ))}
          </ul>
        </section>

        {/* User Conduct */}
        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-foreground mb-4">
            {t("userConduct.title")}
          </h2>
          <p className="text-muted-foreground mb-6">
            {t("userConduct.description")}
          </p>

          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-medium text-foreground mb-3">
                {t("userConduct.prohibitedTitle")}
              </h3>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                {t
                  .raw("userConduct.prohibited")
                  .map((activity: string, index: number) => (
                    <li key={index}>{activity}</li>
                  ))}
              </ul>
            </div>

            <div>
              <h3 className="text-lg font-medium text-foreground mb-3">
                {t("userConduct.expectedTitle")}
              </h3>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                {t
                  .raw("userConduct.expected")
                  .map((behavior: string, index: number) => (
                    <li key={index}>{behavior}</li>
                  ))}
              </ul>
            </div>
          </div>
        </section>

        {/* Trading and Exchanges */}
        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-foreground mb-4">
            {t("trading.title")}
          </h2>
          <p className="text-muted-foreground mb-6">
            {t("trading.description")}
          </p>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4 mb-6">
            {t
              .raw("trading.agreements")
              .map((agreement: string, index: number) => (
                <li key={index}>{agreement}</li>
              ))}
          </ul>
          <div className="bg-muted/50 p-6 rounded-lg">
            <p className="text-muted-foreground font-medium">
              {t("trading.disclaimer")}
            </p>
          </div>
        </section>

        {/* Intellectual Property */}
        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-foreground mb-4">
            {t("intellectualProperty.title")}
          </h2>
          <p className="text-muted-foreground">
            {t("intellectualProperty.description")}
          </p>
        </section>

        {/* Privacy */}
        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-foreground mb-4">
            {t("privacy.title")}
          </h2>
          <p className="text-muted-foreground">{t("privacy.description")}</p>
        </section>

        {/* Account Termination */}
        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-foreground mb-4">
            {t("termination.title")}
          </h2>
          <p className="text-muted-foreground">
            {t("termination.description")}
          </p>
        </section>

        {/* Disclaimer of Warranties */}
        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-foreground mb-4">
            {t("disclaimer.title")}
          </h2>
          <p className="text-muted-foreground">{t("disclaimer.description")}</p>
        </section>

        {/* Limitation of Liability */}
        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-foreground mb-4">
            {t("limitation.title")}
          </h2>
          <p className="text-muted-foreground">{t("limitation.description")}</p>
        </section>

        {/* Changes to Terms */}
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
