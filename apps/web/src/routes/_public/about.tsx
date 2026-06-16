import { createFileRoute } from "@tanstack/react-router";

import { pageTitle } from "@/lib/page-title";

import { Link } from "@/compat/link";
import { Container } from "@/components/marketing/container";
import { FitToWidth } from "@/components/marketing/fit-to-width";
import { PageHero } from "@/components/marketing/page-hero";
import { JigPlank } from "@/components/marketing/plank";
import { Reveal } from "@/components/marketing/reveal";
import { Eyebrow, Section, SectionHead } from "@/components/marketing/section";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { useTranslations } from "use-intl";

import coverSand from "@/components/marketing/assets/cover-sand.webp";

export const Route = createFileRoute("/_public/about")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "about") }],
  }),
  component: AboutPage,
});

// About: the family origin story — mission split with a plank visual,
// values grid, and the kitchen-table timeline.
function AboutPage() {
  const t = useTranslations("marketing.aboutPage");
  const values = [1, 2, 3, 4] as const;
  const timeline = [1, 2, 3] as const;

  return (
    <main>
      <PageHero
        eyebrow={t("heroEyebrow")}
        title={t("heroTitle")}
        lead={t("heroLead")}
      />

      <Section>
        <Container>
          <div className="grid grid-cols-2 max-[860px]:grid-cols-1 gap-[clamp(32px,5vw,72px)] items-center">
            <Reveal>
              <Eyebrow>{t("missionEyebrow")}</Eyebrow>
              <h2 className="font-mk-heading font-bold tracking-tight text-[clamp(26px,3.4vw,38px)] mt-3.5 leading-[1.12] text-mk-text-strong">
                {t("missionTitle")}
              </h2>
              <p className="text-[17px] leading-relaxed text-mk-text-muted mt-4 text-pretty">
                {t("missionBody")}
              </p>
            </Reveal>
            <Reveal delay={120} className="flex justify-center">
              <div className="w-full [filter:drop-shadow(0_24px_36px_rgb(40_30_80_/_.16))]">
                <FitToWidth>
                  <JigPlank
                    depth={16}
                    boxes={[
                      {
                        series: "Familie",
                        title: "Keukentafel",
                        pieceCount: 500,
                        c1: "var(--mk-violet-400)",
                        c2: "var(--mk-violet-600)",
                        width: 100,
                      },
                      { cover: coverSand, title: "Zandsculpturen", width: 132 },
                      {
                        series: "Samen",
                        title: "Eerste ruil",
                        pieceCount: 1000,
                        c1: "var(--mk-green-400)",
                        c2: "var(--mk-green-600)",
                        width: 104,
                      },
                    ]}
                  />
                </FitToWidth>
              </div>
            </Reveal>
          </div>
        </Container>
      </Section>

      <Section tint>
        <Container>
          <SectionHead
            align="center"
            eyebrow={t("valuesEyebrow")}
            title={t("valuesTitle")}
          />
          <div className="grid grid-cols-4 max-[860px]:grid-cols-2 max-[540px]:grid-cols-1 gap-7 mt-12">
            {values.map((n, i) => (
              <Reveal key={n} delay={i * 70}>
                <div className="flex flex-col gap-2.5 pt-4 border-t-2 border-mk-violet-200">
                  <h3 className="font-mk-heading font-bold tracking-tight text-lg text-mk-text-strong">
                    {t(`value${n}Title`)}
                  </h3>
                  <p className="text-[14.5px] leading-relaxed text-mk-text-muted">
                    {t(`value${n}Body`)}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </Container>
      </Section>

      <Section>
        <Container narrow>
          <SectionHead
            align="center"
            eyebrow={t("storyEyebrow")}
            title={t("storyTitle")}
          />
          <div className="mt-12">
            {timeline.map((n, i) => (
              <Reveal key={n} delay={i * 80}>
                <div
                  className={
                    "grid grid-cols-[auto_1fr] gap-[22px] " +
                    (i < timeline.length - 1 ? "pb-8" : "")
                  }
                >
                  <div className="flex flex-col items-center">
                    <span className="font-mono text-[13px] font-bold text-mk-violet-600 bg-mk-violet-50 px-2 py-1 rounded-[6px]">
                      {t(`tl${n}Year`)}
                    </span>
                    {i < timeline.length - 1 && (
                      <span className="flex-1 w-0.5 bg-mk-border mt-2" />
                    )}
                  </div>
                  <div className="pb-1">
                    <h3 className="font-mk-heading font-bold tracking-tight text-xl text-mk-text-strong">
                      {t(`tl${n}Title`)}
                    </h3>
                    <p className="text-[15.5px] leading-relaxed text-mk-text-muted mt-1.5">
                      {t(`tl${n}Body`)}
                    </p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
          <div className="text-center mt-12">
            <Button variant="brand" className="h-11 px-6 text-[15px]" asChild>
              <Link href="/contact">
                {t("cta")}
                <ArrowRight size={17} />
              </Link>
            </Button>
          </div>
        </Container>
      </Section>
    </main>
  );
}
