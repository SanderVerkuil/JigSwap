import { Link } from "@/compat/link";
import { Art } from "@/components/marketing/art";
import floorKitchen from "@/components/marketing/assets/art/floor-kitchen.webp";
import floorLiving from "@/components/marketing/assets/art/floor-living.webp";
import partyGrandma from "@/components/marketing/assets/art/party-grandma.webp";
import partyHandover from "@/components/marketing/assets/art/party-handover.webp";
import { Container } from "@/components/marketing/container";
import { PageHero } from "@/components/marketing/page-hero";
import { Reveal } from "@/components/marketing/reveal";
import { Section } from "@/components/marketing/section";
import { Button } from "@/components/ui/button";
import { pageTitle } from "@/lib/page-title";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useTranslations } from "use-intl";

export const Route = createFileRoute("/_public/about")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "about") }],
  }),
  component: AboutPage,
});

const SECTION_TITLE =
  "font-mk-heading text-mk-text-strong text-[clamp(28px,3.6vw,44px)] leading-[1.1] font-normal tracking-[-0.01em] text-balance";

// About: the family's own story, told from the kitchen table outward. The floors of the cutaway house
// carry it; values are set as a list in large type and the timeline is a lending card.
function AboutPage() {
  const t = useTranslations("marketing.aboutPage");
  const values = [1, 2, 3, 4] as const;
  const timeline = [1, 2, 3] as const;

  return (
    <main>
      <PageHero
        title={t("heroTitle")}
        lead={t("heroLead")}
        aside={
          <Art
            src={floorKitchen}
            width={1344}
            height={344}
            alt={t("heroArtAlt")}
            className="min-h-[170px] object-cover"
          />
        }
      />

      <Section>
        <Container>
          <div className="grid grid-cols-1 items-center gap-x-[clamp(32px,5vw,72px)] gap-y-9 md:grid-cols-2">
            <Reveal>
              <h2 className={SECTION_TITLE}>{t("missionTitle")}</h2>
              <p className="text-mk-text-body mt-4 max-w-[52ch] text-[clamp(18px,1.5vw,21px)] leading-normal text-pretty">
                {t("missionBody")}
              </p>
            </Reveal>
            <Reveal delay={100}>
              <Art
                src={partyGrandma}
                width={784}
                height={680}
                alt={t("missionArtAlt")}
                className="rounded-md"
              />
            </Reveal>
          </div>
        </Container>
      </Section>

      <section className="bg-mk-sky-soft pt-[clamp(56px,8vw,104px)]">
        <Container>
          <Reveal>
            <h2 className={SECTION_TITLE}>{t("valuesTitle")}</h2>
          </Reveal>
          <dl className="mt-[clamp(28px,4vw,48px)] flex flex-col gap-[clamp(24px,3vw,36px)]">
            {values.map((n, i) => (
              <Reveal
                key={n}
                delay={i * 60}
                className="grid grid-cols-1 items-baseline gap-x-[clamp(32px,5vw,72px)] gap-y-1.5 md:grid-cols-[minmax(0,6fr)_minmax(0,6fr)]"
              >
                <dt className="font-mk-heading text-mk-text-strong text-[clamp(26px,3.2vw,40px)] leading-[1.15]">
                  {t(`value${n}Title`)}
                </dt>
                <dd className="text-mk-text-body max-w-[52ch] text-[17px] leading-relaxed text-pretty">
                  {t(`value${n}Body`)}
                </dd>
              </Reveal>
            ))}
          </dl>
          <Reveal className="mt-[clamp(40px,6vw,72px)]">
            <Art
              src={floorLiving}
              width={1129}
              height={292}
              alt={t("valuesArtAlt")}
              className="ml-auto min-h-[170px] max-w-[1129px] rounded-t-md object-cover"
            />
          </Reveal>
        </Container>
      </section>

      <section className="bg-mk-plank py-[clamp(56px,8vw,104px)]">
        <Container>
          <div className="grid grid-cols-1 items-center gap-x-[clamp(32px,5vw,72px)] gap-y-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
            <Reveal>
              <h2 className={SECTION_TITLE}>{t("storyTitle")}</h2>
              <div className="bg-mk-card mt-7 rounded-md px-[clamp(16px,3vw,32px)] pt-[clamp(16px,3vw,28px)] pb-[clamp(16px,3vw,28px)]">
                <table className="w-full border-collapse text-left">
                  <caption className="sr-only">{t("storyTitle")}</caption>
                  <thead>
                    <tr
                      className="border-mk-input-border border-b" // taste-skill-ignore: a real table's head rule.
                    >
                      <th
                        scope="col"
                        className="text-mk-text-muted w-[4.5ch] pr-[clamp(16px,3vw,32px)] pb-2 text-[15px] font-semibold"
                      >
                        {t("slipYear")}
                      </th>
                      <th
                        scope="col"
                        className="text-mk-text-muted pb-2 text-[15px] font-semibold"
                      >
                        {t("slipEntry")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {timeline.map((n) => (
                      <tr
                        key={n}
                        className="border-mk-border border-b last:border-b-0" // taste-skill-ignore: a real table's rows.
                      >
                        <td className="font-mk-heading text-mk-text-strong pt-3.5 pr-[clamp(16px,3vw,32px)] pb-3.5 align-top text-[22px] leading-[1.25] tabular-nums">
                          {t(`tl${n}Year`)}
                        </td>
                        <td className="pt-3.5 pb-3.5 align-top">
                          <div className="text-mk-text-strong text-[17px] leading-snug font-semibold">
                            {t(`tl${n}Title`)}
                          </div>
                          <div className="text-mk-text-body mt-1 text-[17px] leading-normal text-pretty">
                            {t(`tl${n}Body`)}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Button
                variant="default"
                className="mt-7 h-11 px-6 text-[16px]"
                asChild
              >
                <Link href="/contact">
                  {t("cta")}
                  <ArrowRight size={17} />
                </Link>
              </Button>
            </Reveal>
            <Reveal delay={100}>
              <Art
                src={partyHandover}
                width={900}
                height={540}
                alt={t("storyArtAlt")}
                className="rounded-md"
              />
            </Reveal>
          </div>
        </Container>
      </section>
    </main>
  );
}
