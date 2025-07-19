"use client";

import { Building, Mail, MessageSquare, Shield } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";

export default function ContactPage() {
  const t = useTranslations("contact");

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-foreground mb-2">
            {t("title")}
          </h1>
          <p className="text-xl text-muted-foreground mb-4">{t("subtitle")}</p>
          <div className="flex items-center gap-4 text-muted-foreground text-sm">
            <Link href="/" className="hover:text-foreground">
              {t("common.backToHome")}
            </Link>
          </div>
        </div>

        {/* Introduction */}
        <section className="mb-12">
          <p className="text-lg text-muted-foreground leading-relaxed">
            {t("introduction")}
          </p>
        </section>

        {/* Ways to Contact */}
        <section className="mb-12">
          <h2 className="text-3xl font-semibold text-foreground mb-6">
            {t("waysToContact.title")}
          </h2>
          <p className="text-lg text-muted-foreground mb-8 leading-relaxed">
            {t("waysToContact.description")}
          </p>

          <div className="grid md:grid-cols-2 gap-6">
            {/* Email Support */}
            <div className="bg-muted/50 p-6 rounded-lg">
              <div className="flex items-center gap-3 mb-4">
                <Mail className="h-6 w-6 text-primary" />
                <h3 className="text-xl font-medium text-foreground">
                  {t("email.title")}
                </h3>
              </div>
              <p className="text-muted-foreground mb-4">
                {t("email.description")}
              </p>
              <a
                href={`mailto:${t("email.address")}`}
                className="text-primary hover:text-primary/80 font-medium"
              >
                {t("email.address")}
              </a>
              <p className="text-sm text-muted-foreground mt-2">
                {t("email.responseTime")}
              </p>
            </div>

            {/* Technical Support */}
            <div className="bg-muted/50 p-6 rounded-lg">
              <div className="flex items-center gap-3 mb-4">
                <MessageSquare className="h-6 w-6 text-primary" />
                <h3 className="text-xl font-medium text-foreground">
                  {t("support.title")}
                </h3>
              </div>
              <p className="text-muted-foreground mb-4">
                {t("support.description")}
              </p>
              <a
                href={`mailto:${t("support.address")}`}
                className="text-primary hover:text-primary/80 font-medium"
              >
                {t("support.address")}
              </a>
              <p className="text-sm text-muted-foreground mt-2">
                {t("support.responseTime")}
              </p>
            </div>

            {/* Privacy & Legal */}
            <div className="bg-muted/50 p-6 rounded-lg">
              <div className="flex items-center gap-3 mb-4">
                <Shield className="h-6 w-6 text-primary" />
                <h3 className="text-xl font-medium text-foreground">
                  {t("privacy.title")}
                </h3>
              </div>
              <p className="text-muted-foreground mb-4">
                {t("privacy.description")}
              </p>
              <a
                href={`mailto:${t("privacy.address")}`}
                className="text-primary hover:text-primary/80 font-medium"
              >
                {t("privacy.address")}
              </a>
              <p className="text-sm text-muted-foreground mt-2">
                {t("privacy.responseTime")}
              </p>
            </div>

            {/* Business Inquiries */}
            <div className="bg-muted/50 p-6 rounded-lg">
              <div className="flex items-center gap-3 mb-4">
                <Building className="h-6 w-6 text-primary" />
                <h3 className="text-xl font-medium text-foreground">
                  {t("business.title")}
                </h3>
              </div>
              <p className="text-muted-foreground mb-4">
                {t("business.description")}
              </p>
              <a
                href={`mailto:${t("business.address")}`}
                className="text-primary hover:text-primary/80 font-medium"
              >
                {t("business.address")}
              </a>
              <p className="text-sm text-muted-foreground mt-2">
                {t("business.responseTime")}
              </p>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="mb-12">
          <h2 className="text-3xl font-semibold text-foreground mb-6">
            {t("faq.title")}
          </h2>
          <p className="text-lg text-muted-foreground mb-6 leading-relaxed">
            {t("faq.description")}
          </p>
          <div className="bg-muted/50 p-6 rounded-lg">
            <p className="text-muted-foreground mb-4">
              {t("faq.link")} - Coming soon!
            </p>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
              {t.raw("faq.topics").map((topic: string, index: number) => (
                <li key={index}>{topic}</li>
              ))}
            </ul>
          </div>
        </section>

        {/* Feedback */}
        <section className="mb-12">
          <h2 className="text-3xl font-semibold text-foreground mb-6">
            {t("feedback.title")}
          </h2>
          <p className="text-lg text-muted-foreground mb-6 leading-relaxed">
            {t("feedback.description")}
          </p>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
            {t.raw("feedback.types").map((type: string, index: number) => (
              <li key={index} className="text-lg">
                {type}
              </li>
            ))}
          </ul>
        </section>

        {/* Response Expectations */}
        <section className="mb-12">
          <h2 className="text-3xl font-semibold text-foreground mb-6">
            {t("response.title")}
          </h2>
          <p className="text-lg text-muted-foreground mb-6 leading-relaxed">
            {t("response.description")}
          </p>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
            {t
              .raw("response.expectations")
              .map((expectation: string, index: number) => (
                <li key={index} className="text-lg">
                  {expectation}
                </li>
              ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
