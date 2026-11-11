import { Link } from "@/compat/link";
import { MAIN_CONTENT_ID } from "@/components/a11y/skip-link";
import { Art } from "@/components/marketing/art";
import boxCover from "@/components/marketing/assets/art/covers/dorpsstraat.webp";
import {
  coverSrcSet,
  journeyArt,
  parkBridge,
  parkBridgeSrcSet,
} from "@/components/marketing/assets/art/renditions";
import { Container } from "@/components/marketing/container";
import { PageHero } from "@/components/marketing/page-hero";
import { Reveal } from "@/components/marketing/reveal";
import { Section } from "@/components/marketing/section";
import { useStartLink } from "@/components/marketing/use-start-link";
import { Button } from "@/components/ui/button";
import { seoHead } from "@/lib/seo-head";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslations } from "use-intl";

export const Route = createFileRoute("/_public/how-it-works")({
  head: ({ match }) => seoHead(match, "howItWorks"),
  component: HowItWorksPage,
});

// One box, one journey, told as one bookcase: each stop is a shelf running the width of the page, with
// its picture, what happens, and the same box standing on the ledge. The label beside the box says
// where it is right now, which is the question the product exists to answer. The pictures follow the
// same Dorpsstraat box: onto the girl's shelf, onto a neighbour's screen, across her doorstep, home.
const STOPS = [
  { n: 1, art: journeyArt[0] },
  { n: 2, art: journeyArt[1] },
  { n: 3, art: journeyArt[2] },
  { n: 4, art: journeyArt[3] },
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
    <Button variant="brand" size="public" asChild>
      <Link href={start.href}>{start.label}</Link>
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
            src={parkBridge}
            srcSet={parkBridgeSrcSet}
            // 7 of 12 columns out to the right edge from 1024px; the full width below.
            sizes="(min-width: 1024px) 57vw, 100vw"
            width={1600}
            height={966}
            alt={t("heroArtAlt")}
            priority
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
                <div>
                  <Art
                    src={stop.art.src}
                    srcSet={stop.art.srcSet}
                    // 5 of 12 columns inside the 40px edges from 1024px; the content width below.
                    sizes="(min-width: 1024px) 37vw, (min-width: 760px) calc(100vw - 80px), calc(100vw - 32px)"
                    width={1536}
                    height={864}
                    alt={t(`step${stop.n}Alt`)}
                    className="aspect-[16/9] rounded-t-md object-cover"
                  />
                </div>
                <div className="lg:self-center lg:pb-6">
                  <h3 className="font-mk-heading text-mk-text-strong text-[clamp(24px,2.6vw,36px)] leading-[1.12] font-normal text-balance">
                    {t(`step${stop.n}Title`)}
                  </h3>
                  <p className="text-mk-text-body mt-3 max-w-[56ch] text-[17px] leading-relaxed text-pretty">
                    {t(`step${stop.n}Body`)}
                  </p>
                </div>
                <div className="flex items-end gap-4">
                  {/* `sizes` follows the width's clamp: 10vw is 96px at 960px and 152px at 1520px. */}
                  <img
                    src={boxCover}
                    srcSet={coverSrcSet(boxCover)}
                    sizes="(min-width: 1520px) 152px, (max-width: 960px) 96px, 10vw"
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
                </div>
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
              {modes.map((n) => (
                <div key={n}>
                  <h3 className="font-mk-heading text-[clamp(24px,2.6vw,32px)] leading-[1.15] font-normal">
                    {t(`mode${n}Title`)}
                  </h3>
                  <p className="mt-2 max-w-[60ch] text-[17px] leading-relaxed text-pretty">
                    {t(`mode${n}Body`)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </Container>
      </section>

      <Section>
        <Container>
          <div className="grid grid-cols-1 gap-x-[clamp(24px,4vw,72px)] gap-y-9 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <div>
              <Reveal>
                <h2 className="font-mk-heading text-mk-text-strong text-[clamp(28px,3.6vw,44px)] leading-[1.1] font-normal tracking-[-0.01em] text-balance">
                  {t("faqTitle")}
                </h2>
              </Reveal>
              <div className="mt-7 max-md:hidden">{startButton}</div>
            </div>
            <dl className="flex flex-col gap-8">
              {faqs.map((n) => (
                <div key={n}>
                  <dt className="font-mk-heading text-mk-text-strong text-[22px] leading-[1.25]">
                    {t(`faq${n}Q`)}
                  </dt>
                  <dd className="text-mk-text-body mt-2 max-w-[62ch] text-[17px] leading-relaxed text-pretty">
                    {t(`faq${n}A`)}
                  </dd>
                </div>
              ))}
            </dl>
            <div className="md:hidden">{startButton}</div>
          </div>
        </Container>
      </Section>
    </main>
  );
}
