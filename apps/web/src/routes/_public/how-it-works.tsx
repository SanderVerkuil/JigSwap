import { createFileRoute } from "@tanstack/react-router";

import { pageTitle } from "@/lib/page-title";

import { Link } from "@/compat/link";
import { Container } from "@/components/marketing/container";
import { FaqItem } from "@/components/marketing/faq-item";
import { PageHero } from "@/components/marketing/page-hero";
import { Reveal } from "@/components/marketing/reveal";
import { Section, SectionHead } from "@/components/marketing/section";
import { useStartHref } from "@/components/marketing/use-start-href";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { useTranslations } from "use-intl";

export const Route = createFileRoute("/_public/how-it-works")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "howItWorks") }],
  }),
  component: HowItWorksPage,
});

const MODE_ACCENTS = [
  "var(--mk-violet-400)",
  "var(--mk-green-500)",
  "var(--mk-pink-400)",
] as const;

// How it works: five numbered steps, the three sharing modes, and an FAQ.
// Copy reflects shipped behaviour: manual puzzle entry (EAN optional, no
// scanner), exchange proposals (no general DMs), in-app recall notifications.
function HowItWorksPage() {
  const t = useTranslations("marketing.how");
  const tNav = useTranslations("marketing.nav");
  const startHref = useStartHref();
  const steps = [1, 2, 3, 4, 5] as const;
  const modes = [1, 2, 3] as const;
  const faqs = [1, 2, 3, 4] as const;

  return (
    <main>
      <PageHero
        eyebrow={t("heroEyebrow")}
        title={t("heroTitle")}
        lead={t("heroLead")}
      />

      <Section>
        <Container narrow>
          <div className="flex flex-col gap-2">
            {steps.map((n, i) => (
              <Reveal key={n} delay={i * 60}>
                <div
                  className={
                    "grid grid-cols-[auto_1fr] gap-6 py-[22px] " +
                    (i < steps.length - 1 ? "border-b border-mk-border" : "")
                  }
                >
                  <span className="font-mk-heading font-bold text-[30px] leading-none text-mk-violet-600 min-w-10">
                    {n}
                  </span>
                  <div>
                    <h3 className="font-mk-heading font-bold tracking-tight text-[22px] text-mk-text-strong">
                      {t(`step${n}Title`)}
                    </h3>
                    <p className="text-base leading-relaxed text-mk-text-muted mt-2 text-pretty">
                      {t(`step${n}Body`)}
                    </p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </Container>
      </Section>

      <Section tint>
        <Container>
          <SectionHead
            align="center"
            eyebrow={t("modesEyebrow")}
            title={t("modesTitle")}
            lead={t("modesLead")}
          />
          <div className="grid grid-cols-3 max-[860px]:grid-cols-1 gap-6 mt-12">
            {modes.map((n, i) => (
              <Reveal key={n} delay={i * 90}>
                <div
                  className="flex flex-col gap-2.5 pt-[18px] h-full border-t-[3px]"
                  style={{ borderTopColor: MODE_ACCENTS[i] }}
                >
                  <div className="font-mono text-[11px] font-bold tracking-[.08em] uppercase text-mk-text-muted">
                    {t(`mode${n}Tag`)}
                  </div>
                  <h3 className="font-mk-heading font-bold tracking-tight text-2xl text-mk-text-strong">
                    {t(`mode${n}Title`)}
                  </h3>
                  <p className="text-[15px] leading-relaxed text-mk-text-muted">
                    {t(`mode${n}Body`)}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </Container>
      </Section>

      <Section>
        <Container narrow>
          <SectionHead eyebrow={t("faqEyebrow")} title={t("faqTitle")} />
          <div className="mt-9">
            {faqs.map((n, i) => (
              <FaqItem
                key={n}
                q={t(`faq${n}Q`)}
                a={t(`faq${n}A`)}
                last={i === faqs.length - 1}
              />
            ))}
          </div>
          <div className="mt-10">
            <Button variant="brand" className="h-11 px-6 text-[15px]" asChild>
              <Link href={startHref}>
                {tNav("startTrading")}
                <ArrowRight size={17} />
              </Link>
            </Button>
          </div>
        </Container>
      </Section>
    </main>
  );
}
