import { createFileRoute } from "@tanstack/react-router";

import { pageTitle } from "@/lib/page-title";

import { Link } from "@/compat/link";
import { LegalDoc, type LegalSection } from "@/components/marketing/legal-doc";
import { PageHero } from "@/components/marketing/page-hero";
import { useTranslations } from "use-intl";

export const Route = createFileRoute("/_public/privacy")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "privacy") }],
  }),
  component: PrivacyPolicyPage,
});

// Privacy policy in the marketing LegalDoc layout (sticky TOC + reading
// column). The `privacy` catalog holds real copy tailored to what JigSwap does.
function PrivacyPolicyPage() {
  const t = useTranslations("privacy");
  const tm = useTranslations("marketing.legal");

  const list = (key: string): string[] => t.raw(key) as string[];

  const sections: LegalSection[] = [
    {
      id: "p-collect",
      heading: t("informationWeCollect.title"),
      blocks: [
        { type: "p", text: t("informationWeCollect.description") },
        {
          type: "sub",
          text: t("informationWeCollect.personalInformation.title"),
        },
        {
          type: "list",
          items: list("informationWeCollect.personalInformation.items"),
        },
        {
          type: "sub",
          text: t("informationWeCollect.automaticallyCollected.title"),
        },
        {
          type: "list",
          items: list("informationWeCollect.automaticallyCollected.items"),
        },
      ],
    },
    {
      id: "p-use",
      heading: t("howWeUseInformation.title"),
      blocks: [
        { type: "p", text: t("howWeUseInformation.description") },
        { type: "list", items: list("howWeUseInformation.purposes") },
        { type: "sub", text: t("howWeUseInformation.lawfulBasis.title") },
        { type: "p", text: t("howWeUseInformation.lawfulBasis.description") },
        { type: "list", items: list("howWeUseInformation.lawfulBasis.items") },
      ],
    },
    {
      id: "p-storage",
      heading: t("dataStorage.title"),
      blocks: [
        { type: "p", text: t("dataStorage.description") },
        { type: "sub", text: t("dataStorage.convex.title") },
        { type: "p", text: t("dataStorage.convex.description") },
        { type: "sub", text: t("dataStorage.clerk.title") },
        { type: "p", text: t("dataStorage.clerk.description") },
        { type: "sub", text: t("dataStorage.vercel.title") },
        { type: "p", text: t("dataStorage.vercel.description") },
      ],
    },
    {
      id: "p-photos",
      heading: t("photos.title"),
      blocks: [
        { type: "p", text: t("photos.description") },
        { type: "list", items: list("photos.steps") },
      ],
    },
    {
      id: "p-analytics",
      heading: t("analytics.title"),
      blocks: [
        { type: "p", text: t("analytics.description") },
        { type: "sub", text: t("analytics.posthog.title") },
        { type: "p", text: t("analytics.posthog.description") },
        { type: "strong", text: t("analytics.noAdvertising") },
      ],
    },
    {
      id: "p-sharing",
      heading: t("dataSharing.title"),
      blocks: [
        { type: "p", text: t("dataSharing.description") },
        { type: "strong", text: t("dataSharing.noSale") },
        { type: "p", text: t("dataSharing.limitedSharing") },
        { type: "list", items: list("dataSharing.circumstances") },
      ],
    },
    {
      id: "p-security",
      heading: t("dataSecurity.title"),
      blocks: [
        { type: "p", text: t("dataSecurity.description") },
        { type: "list", items: list("dataSecurity.measures") },
      ],
    },
    {
      id: "p-rights",
      heading: t("yourRights.title"),
      blocks: [
        { type: "p", text: t("yourRights.description") },
        { type: "list", items: list("yourRights.rights") },
      ],
    },
    {
      id: "p-cookies",
      heading: t("cookies.title"),
      blocks: [
        { type: "p", text: t("cookies.description") },
        { type: "list", items: list("cookies.types") },
        { type: "p", text: t("cookies.control") },
      ],
    },
    {
      id: "p-children",
      heading: t("children.title"),
      blocks: [{ type: "p", text: t("children.description") }],
    },
    {
      id: "p-international",
      heading: t("international.title"),
      blocks: [{ type: "p", text: t("international.description") }],
    },
    {
      id: "p-changes",
      heading: t("changes.title"),
      blocks: [{ type: "p", text: t("changes.description") }],
    },
  ];

  return (
    <main>
      <PageHero
        eyebrow={tm("eyebrow")}
        title={t("title")}
        lead={tm("privacyLead")}
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
