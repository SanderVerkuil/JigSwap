import { Link } from "@/compat/link";
import { MAIN_CONTENT_ID } from "@/components/a11y/skip-link";
import { Art } from "@/components/marketing/art";
import atticBoxes from "@/components/marketing/assets/art/attic-boxes.webp";
import boxCover from "@/components/marketing/assets/art/covers/dorpsstraat.webp";
import floorBedroom from "@/components/marketing/assets/art/floor-bedroom.webp";
import partyBarrow from "@/components/marketing/assets/art/party-barrow.webp";
import partyBridge from "@/components/marketing/assets/art/party-bridge.webp";
import windowsHandover from "@/components/marketing/assets/art/windows-handover.webp";
import { Container } from "@/components/marketing/container";
import { PageHero } from "@/components/marketing/page-hero";
import { Reveal } from "@/components/marketing/reveal";
import { Section } from "@/components/marketing/section";
import { useStartLink } from "@/components/marketing/use-start-link";
import { Button } from "@/components/ui/button";
import { seoHead } from "@/lib/seo-head";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useTranslations } from "use-intl";

export const Route = createFileRoute("/_public/how-it-works")({
  head: ({ match }) => seoHead(match, "howItWorks"),
  component: HowItWorksPage,
});

// One box, one journey, told as one bookcase: each stop is a shelf running the width of the page, with
// its picture, what happens, and the same box standing on the ledge. The label beside the box says
// where it is right now, which is the question the product exists to answer.
const STOPS = [
  { n: 1, art: atticBoxes, width: 640, height: 360 },
  { n: 2, art: partyBarrow, width: 809, height: 493 },
  { n: 3, art: windowsHandover, width: 840, height: 372 },
  { n: 4, art: floorBedroom, width: 704, height: 344 },
] as const;

// The sample box on the journey; a constant like the sample shelves on the home page.
const BOX_TITLE = "Dorpsstraat";

function HowItWorksPage() {
  const t = useTranslations("marketing.how");
  const tNav = useTranslations("marketing.nav");
  const start = useStartLink();
  const modes = [1, 2, 3] as const;
  const faqs = [1, 2, 3, 4] as const;

  const startButton = (
    <Button variant="brand" className="h-11 px-6 text-[16px]" asChild>
      <Link href={start.href}>
        {start.label}
        <ArrowRight size={17} />
      </Link>
    </Button>
  );

  return (
    <main id={MAIN_CONTENT_ID}>
      <PageHero
        title={t("heroTitle")}
        lead={t("heroLead")}
        action={startButton}
        aside={
          <Art
            src={partyBridge}
            width={995}
            height={614}
            alt={t("heroArtAlt")}
            className="rounded-t-md"
          />
        }
      />

      <section className="bg-mk-sky-soft dark:bg-mk-muted pt-[clamp(56px,8vw,104px)]">
        <Container>
          <h2 className="font-mk-heading text-mk-text-strong text-[clamp(28px,3.6vw,44px)] leading-[1.1] font-normal tracking-[-0.01em] text-balance">
            {t("stopsTitle")}
          </h2>
        </Container>
        <ol className="mt-[clamp(24px,3vw,40px)]">
          {STOPS.map((stop) => (
            <li key={stop.n} className="pt-[clamp(24px,3vw,40px)]">
              <Container className="grid grid-cols-1 gap-x-[clamp(24px,3vw,48px)] gap-y-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)_minmax(0,3fr)] lg:items-end">
                <Reveal>
                  <Art
                    src={stop.art}
                    width={stop.width}
                    height={stop.height}
                    alt={t(`step${stop.n}Alt`)}
                    className="aspect-[16/9] rounded-t-md object-cover"
                  />
                </Reveal>
                <Reveal delay={70} className="lg:self-center lg:pb-6">
                  <h3 className="font-mk-heading text-mk-text-strong text-[clamp(24px,2.6vw,36px)] leading-[1.12] font-normal text-balance">
                    {t(`step${stop.n}Title`)}
                  </h3>
                  <p className="text-mk-text-body mt-3 max-w-[56ch] text-[17px] leading-relaxed text-pretty">
                    {t(`step${stop.n}Body`)}
                  </p>
                </Reveal>
                <Reveal delay={140} className="flex items-end gap-4">
                  <img
                    src={boxCover}
                    alt=""
                    width={480}
                    height={360}
                    loading="lazy"
                    decoding="async"
                    className="block h-auto w-[clamp(96px,10vw,152px)] shrink-0 rounded-t-[2px]"
                  />
                  <p className="text-mk-text-strong max-w-[20ch] pb-3 text-[17px] leading-snug">
                    <span className="block font-bold">{BOX_TITLE}</span>
                    <span className="bg-mk-card mt-1.5 block rounded-sm px-2.5 py-1 font-semibold text-pretty">
                      {t(`step${stop.n}Where`)}
                    </span>
                  </p>
                </Reveal>
              </Container>
              <div aria-hidden="true" className="bg-mk-plank h-[9px]" />
            </li>
          ))}
        </ol>
        <div className="h-[clamp(40px,6vw,72px)]" />
      </section>

      <section className="bg-mk-canal text-mk-on-canal py-[clamp(56px,8vw,104px)]">
        <Container>
          <div className="grid grid-cols-1 gap-x-[clamp(24px,4vw,72px)] gap-y-9 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <Reveal>
              <h2 className="font-mk-heading text-[clamp(28px,3.6vw,44px)] leading-[1.1] font-normal tracking-[-0.01em] text-balance">
                {t("modesTitle")}
              </h2>
              <p className="mt-4 max-w-[38ch] text-[clamp(18px,1.5vw,21px)] leading-normal text-pretty">
                {t("modesLead")}
              </p>
            </Reveal>
            <div className="flex flex-col gap-9">
              {modes.map((n, i) => (
                <Reveal key={n} delay={i * 70}>
                  <h3 className="font-mk-heading text-[clamp(24px,2.6vw,32px)] leading-[1.15] font-normal">
                    {t(`mode${n}Title`)}
                  </h3>
                  <p className="mt-2 max-w-[60ch] text-[17px] leading-relaxed text-pretty">
                    {t(`mode${n}Body`)}
                  </p>
                </Reveal>
              ))}
            </div>
          </div>
        </Container>
      </section>

      <Section>
        <Container>
          <div className="grid grid-cols-1 gap-x-[clamp(24px,4vw,72px)] gap-y-9 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <Reveal>
              <h2 className="font-mk-heading text-mk-text-strong text-[clamp(28px,3.6vw,44px)] leading-[1.1] font-normal tracking-[-0.01em] text-balance">
                {t("faqTitle")}
              </h2>
              <div className="mt-7 max-md:hidden">{startButton}</div>
            </Reveal>
            <dl className="flex flex-col gap-8">
              {faqs.map((n) => (
                <Reveal key={n}>
                  <dt className="font-mk-heading text-mk-text-strong text-[22px] leading-[1.25]">
                    {t(`faq${n}Q`)}
                  </dt>
                  <dd className="text-mk-text-body mt-2 max-w-[62ch] text-[17px] leading-relaxed text-pretty">
                    {t(`faq${n}A`)}
                  </dd>
                </Reveal>
              ))}
            </dl>
            <div className="md:hidden">{startButton}</div>
          </div>
        </Container>
      </Section>
    </main>
  );
}
