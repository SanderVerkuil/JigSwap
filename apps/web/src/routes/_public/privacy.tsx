import { Link } from "@/compat/link";
import { LegalDoc, type LegalSection } from "@/components/marketing/legal-doc";
import { PageHero } from "@/components/marketing/page-hero";
import { pageTitle } from "@/lib/page-title";
import { createFileRoute } from "@tanstack/react-router";
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
        { type: "sub", text: t("dataStorage.sightengine.title") },
        { type: "p", text: t("dataStorage.sightengine.description") },
        { type: "sub", text: t("dataStorage.maptiler.title") },
        { type: "p", text: t("dataStorage.maptiler.description") },
        { type: "sub", text: t("dataStorage.axiom.title") },
        { type: "p", text: t("dataStorage.axiom.description") },
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
    // Messaging, safety and retention (spec 2.4-2.8). [LAWYER] A lawyer should review these three
    // sections, in particular: withholding the reporter's identity in an access request (GDPR Art.
    // 15(4), UAVG Art. 41) and not disclosing a block list to the blocked member; keeping a deleted
    // member's text messages; and the retention periods. Verify the Axiom dataset retention is set
    // to 30 days before relying on that line.
    // Screening runs on Sightengine only (MODERATION_PROVIDER=sightengine on dev and prod); the
    // Hugging Face adapter is still in the code but not used, so it is not listed. Offlimits /
    // EOKM HashCheckService (CSAM hash matching, spec R.11) is not enabled
    // (CSAM_HASHCHECK_PROVIDER unset), so no hash-list matching is claimed. When it is: add it to
    // the photo pipeline steps and name Offlimits and the police as recipients under a legal
    // obligation (dataSharing.circumstances).
    {
      id: "p-messaging",
      heading: t("messaging.title"),
      blocks: [
        { type: "p", text: t("messaging.description") },
        { type: "list", items: list("messaging.items") },
      ],
    },
    // Group chats, online status and typing (group-threads spec 5.6). [LAWYER] Online status
    // relies on legitimate interest (Art. 6(1)(f)) with opt-in, mutual-only and reciprocal
    // safeguards, not consent; a lawyer should confirm that framing. Keep these lines in step
    // with getPresenceOf (INVISIBLE_VIEWERS_SEE_OTHERS) and the typing gates. No new processors.
    {
      id: "p-groups",
      heading: t("groups.title"),
      blocks: [
        { type: "p", text: t("groups.description") },
        { type: "list", items: list("groups.items") },
      ],
    },
    {
      id: "p-presence",
      heading: t("presence.title"),
      blocks: [
        { type: "p", text: t("presence.description") },
        { type: "sub", text: t("presence.onlineTitle") },
        { type: "list", items: list("presence.onlineItems") },
        { type: "sub", text: t("presence.typingTitle") },
        { type: "list", items: list("presence.typingItems") },
      ],
    },
    {
      id: "p-safety",
      heading: t("safety.title"),
      blocks: [
        { type: "p", text: t("safety.description") },
        { type: "sub", text: t("safety.blockingTitle") },
        { type: "p", text: t("safety.blocking") },
        { type: "sub", text: t("safety.reportingTitle") },
        { type: "p", text: t("safety.reportingDescription") },
        { type: "list", items: list("safety.reportingItems") },
        { type: "strong", text: t("safety.reporterWithheld") },
      ],
    },
    // "When you delete your account" mirrors the account purge (conversation/
    // purgeMemberMessagingData). [LAWYER] A lawyer should confirm keeping a deleted member's
    // reviews, comments, trade history, catalogue contributions and the History of copies they
    // gave away (shown as "Deleted member", no identity), and handing their circles to another
    // member.
    {
      id: "p-retention",
      heading: t("retention.title"),
      blocks: [
        { type: "p", text: t("retention.description") },
        { type: "list", items: list("retention.items") },
        { type: "sub", text: t("retention.deletionTitle") },
        { type: "list", items: list("retention.deletion") },
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
