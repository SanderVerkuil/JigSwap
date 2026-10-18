import { Link } from "@/compat/link";
import { LegalDoc, type LegalSection } from "@/components/marketing/legal-doc";
import { PageHero } from "@/components/marketing/page-hero";
import { pageTitle } from "@/lib/page-title";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslations } from "use-intl";

export const Route = createFileRoute("/_public/terms")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "terms") }],
  }),
  component: TermsOfServicePage,
});

// Terms of service in the marketing LegalDoc layout (sticky TOC + reading
// column). The `terms` catalog holds real copy tailored to what JigSwap does.
function TermsOfServicePage() {
  const t = useTranslations("terms");
  const tm = useTranslations("marketing.legal");

  const list = (key: string): string[] => t.raw(key) as string[];

  const sections: LegalSection[] = [
    {
      id: "t-acceptance",
      heading: t("acceptance.title"),
      blocks: [{ type: "p", text: t("acceptance.description") }],
    },
    {
      id: "t-service",
      heading: t("serviceDescription.title"),
      blocks: [
        { type: "p", text: t("serviceDescription.description") },
        { type: "list", items: list("serviceDescription.features") },
      ],
    },
    {
      id: "t-accounts",
      heading: t("userAccounts.title"),
      blocks: [
        { type: "p", text: t("userAccounts.description") },
        { type: "list", items: list("userAccounts.responsibilities") },
      ],
    },
    {
      id: "t-conduct",
      heading: t("userConduct.title"),
      blocks: [
        { type: "p", text: t("userConduct.description") },
        { type: "sub", text: t("userConduct.expectedTitle") },
        { type: "list", items: list("userConduct.expected") },
        { type: "sub", text: t("userConduct.prohibitedTitle") },
        { type: "list", items: list("userConduct.prohibited") },
      ],
    },
    // DSA Art. 14: how moderation works, including automated tools. [LAWYER] A lawyer should
    // review this section (the review route is voluntary: Art. 20 does not apply at our size).
    {
      id: "t-moderation",
      heading: t("moderation.title"),
      blocks: [
        { type: "p", text: t("moderation.description") },
        { type: "sub", text: t("moderation.screeningTitle") },
        { type: "p", text: t("moderation.screening") },
        { type: "sub", text: t("moderation.reportingTitle") },
        { type: "p", text: t("moderation.reporting") },
        { type: "sub", text: t("moderation.decisionsTitle") },
        { type: "p", text: t("moderation.decisions") },
        { type: "sub", text: t("moderation.reviewTitle") },
        { type: "p", text: t("moderation.review") },
        { type: "sub", text: t("moderation.blockingTitle") },
        { type: "p", text: t("moderation.blocking") },
      ],
    },
    {
      id: "t-trading",
      heading: t("trading.title"),
      blocks: [
        { type: "p", text: t("trading.description") },
        { type: "list", items: list("trading.agreements") },
        { type: "strong", text: t("trading.disclaimer") },
      ],
    },
    {
      id: "t-ip",
      heading: t("intellectualProperty.title"),
      blocks: [
        { type: "p", text: t("intellectualProperty.description") },
        { type: "sub", text: t("intellectualProperty.yourContent.title") },
        { type: "p", text: t("intellectualProperty.yourContent.description") },
        { type: "sub", text: t("intellectualProperty.platform.title") },
        { type: "p", text: t("intellectualProperty.platform.description") },
      ],
    },
    {
      id: "t-privacy",
      heading: t("privacy.title"),
      blocks: [{ type: "p", text: t("privacy.description") }],
    },
    {
      id: "t-termination",
      heading: t("termination.title"),
      blocks: [{ type: "p", text: t("termination.description") }],
    },
    {
      id: "t-disclaimer",
      heading: t("disclaimer.title"),
      blocks: [{ type: "p", text: t("disclaimer.description") }],
    },
    {
      id: "t-limitation",
      heading: t("limitation.title"),
      blocks: [{ type: "p", text: t("limitation.description") }],
    },
    {
      id: "t-changes",
      heading: t("changes.title"),
      blocks: [{ type: "p", text: t("changes.description") }],
    },
  ];

  return (
    <main>
      <PageHero
        eyebrow={tm("eyebrow")}
        title={t("title")}
        lead={tm("termsLead")}
      />
      <LegalDoc
        updated={`${t("lastUpdated")}: ${t("effectiveDate")}`}
        intro={t("introduction")}
        sections={sections}
      >
        {t("contact.description")}{" "}
        <a
          href={`mailto:${t("contact.emailAddress")}`}
          className="text-mk-violet-600 font-medium hover:underline"
        >
          {t("contact.emailAddress")}
        </a>
        . {t("contact.formNote")}{" "}
        <Link
          href="/contact"
          className="text-mk-violet-600 font-medium hover:underline"
        >
          {t("contact.linkLabel")}
        </Link>
        .
      </LegalDoc>
    </main>
  );
}
