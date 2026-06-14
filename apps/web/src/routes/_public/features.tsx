import { createFileRoute } from "@tanstack/react-router";

import { pageTitle } from "@/lib/page-title";

import { Link } from "@/compat/link";
import { Container } from "@/components/marketing/container";
import { PageHero } from "@/components/marketing/page-hero";
import { Reveal } from "@/components/marketing/reveal";
import { Section, SectionHead } from "@/components/marketing/section";
import { useStartHref } from "@/components/marketing/use-start-href";
import { Button } from "@/components/ui/button";
import { useTranslations } from "use-intl";

export const Route = createFileRoute("/_public/features")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "features") }],
  }),
  component: FeaturesPage,
});

// Features: four groups of three, each item mapped to a shipped capability
// (library metadata, collections, completions+goals; lending overview &
// custody statuses; browse filters, recent catalog additions, the exchange
// lifecycle; circles, reviews/trust levels, following & public profiles).
function FeaturesPage() {
  const t = useTranslations("marketing.features");
  const tNav = useTranslations("marketing.nav");
  const startHref = useStartHref();
  const groups = [1, 2, 3, 4] as const;
  const items = [1, 2, 3] as const;

  return (
    <main>
      <PageHero
        eyebrow={t("heroEyebrow")}
        title={t("heroTitle")}
        lead={t("heroLead")}
      />
      {groups.map((g, gi) => (
        <Section key={g} tint={gi % 2 === 1}>
          <Container>
            <Reveal>
              <SectionHead
                eyebrow={t(`g${g}Eyebrow`)}
                title={t(`g${g}Title`)}
              />
            </Reveal>
            <div className="grid grid-cols-3 max-[860px]:grid-cols-1 gap-9 mt-11">
              {items.map((i, ii) => (
                <Reveal key={i} delay={ii * 80}>
                  <div className="flex flex-col gap-2.5 pt-[18px] border-t-2 border-mk-violet-200">
                    <h3 className="font-mk-heading font-bold tracking-tight text-[19px] text-mk-text-strong">
                      {t(`g${g}i${i}Title`)}
                    </h3>
                    <p className="text-[15px] leading-relaxed text-mk-text-muted">
                      {t(`g${g}i${i}Body`)}
                    </p>
                  </div>
                </Reveal>
              ))}
            </div>
          </Container>
        </Section>
      ))}
      <Section>
        <Container className="text-center">
          <h2 className="font-mk-heading font-bold tracking-tight text-[clamp(26px,3.4vw,38px)] text-mk-text-strong">
            {t("ctaTitle")}
          </h2>
          <div className="mt-[26px] flex justify-center gap-3 flex-wrap">
            <Button variant="brand" className="h-11 px-6 text-[15px]" asChild>
              <Link href={startHref}>{tNav("startTrading")}</Link>
            </Button>
            <Button
              variant="outline"
              className="h-11 px-6 text-[15px] bg-mk-card border-mk-border text-mk-text-strong hover:bg-mk-muted"
              asChild
            >
              <Link href="/about">{t("ctaAbout")}</Link>
            </Button>
          </div>
        </Container>
      </Section>
    </main>
  );
}
