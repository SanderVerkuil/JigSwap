import { Link } from "@/compat/link";
import { MAIN_CONTENT_ID } from "@/components/a11y/skip-link";
import { StreetSkyline } from "@/components/common/street-skyline";
import { Art } from "@/components/marketing/art";
import amsterdam from "@/components/marketing/assets/art/covers/amsterdam.webp";
import dorpsstraat from "@/components/marketing/assets/art/covers/dorpsstraat.webp";
import grachtje from "@/components/marketing/assets/art/covers/grachtje.webp";
import molen from "@/components/marketing/assets/art/covers/molen.webp";
import tulpen from "@/components/marketing/assets/art/covers/tulpen.webp";
import floorBedroom from "@/components/marketing/assets/art/floor-bedroom.webp";
import { coverSrcSet } from "@/components/marketing/assets/art/renditions";
import windowsHandover from "@/components/marketing/assets/art/windows-handover.webp";
import { Container } from "@/components/marketing/container";
import { PageHero } from "@/components/marketing/page-hero";
import { Reveal } from "@/components/marketing/reveal";
import { useStartLink } from "@/components/marketing/use-start-link";
import { Button } from "@/components/ui/button";
import { seoHead } from "@/lib/seo-head";
import { cn } from "@/lib/utils";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslations } from "use-intl";

export const Route = createFileRoute("/_public/features")({
  head: ({ match }) => seoHead(match, "features"),
  component: FeaturesPage,
});

const BAND_TITLE =
  "font-mk-heading text-[clamp(28px,3.6vw,44px)] leading-[1.1] font-normal tracking-[-0.01em] text-balance";
const BAND_PADDING = "py-[clamp(56px,7vw,96px)]";

const SENTENCES =
  "max-w-[46ch] text-[clamp(18px,1.5vw,21px)] leading-[1.5] text-pretty";

// Each row of the lending fragment shows one state the product really has, as an example.
const LENDING_ROWS = [
  {
    n: 1,
    cover: dorpsstraat,
    tone: "bg-mk-warning-soft text-mk-warning-strong",
  },
  {
    n: 2,
    cover: molen,
    tone: "bg-mk-success-soft text-mk-success-strong",
  },
  {
    n: 3,
    cover: amsterdam,
    tone: "bg-mk-danger-soft text-mk-danger-strong",
  },
] as const;

// The four filters the catalogue has, with a sample value each.
const SAMPLE_FILTERS = [
  ["chipPieces", "valPieces"],
  ["chipDifficulty", "valDifficulty"],
  ["chipCondition", "valCondition"],
  ["chipCategory", "valCategory"],
] as const;

// Sample results; titles and owners are constants, like the sample shelves on the home page.
const SAMPLE_RESULTS = [
  { title: "Tulpen", cover: tulpen, owner: "Sanne" },
  { title: "Grachtje", cover: grachtje, owner: "Opa Wim" },
] as const;

// Features: each capability group is one storey with its own density. The custody list dominates one,
// a sample search stands in another, and the rest is a sentence each. Every sentence maps to a shipped
// capability (library metadata, collections, completions and goals; lending overview and custody
// statuses; browse filters, recent catalogue additions and the exchange lifecycle; circles, reviews and
// trust levels, following and profiles).
function FeaturesPage() {
  const t = useTranslations("marketing.features");
  const tNav = useTranslations("marketing.nav");
  const start = useStartLink();

  const sentences = (g: 1 | 2 | 3 | 4, className?: string) => (
    <p className={cn(SENTENCES, className)}>
      {t(`g${g}i1Body`)} {t(`g${g}i2Body`)} {t(`g${g}i3Body`)}
    </p>
  );

  return (
    <main id={MAIN_CONTENT_ID}>
      <PageHero
        title={t("heroTitle")}
        lead={t("heroLead")}
        action={
          <Button variant="brand" size="public" asChild>
            <Link href={start.href}>{start.label}</Link>
          </Button>
        }
      />

      <section
        className={cn(
          "bg-mk-sky-soft dark:bg-mk-muted text-mk-text-strong",
          BAND_PADDING,
        )}
      >
        <Container>
          <div className="grid grid-cols-1 items-center gap-x-[clamp(24px,5vw,72px)] gap-y-9 md:grid-cols-2">
            <Reveal>
              <h2 className={BAND_TITLE}>{t("g1Title")}</h2>
              {sentences(1, "mt-5")}
            </Reveal>
            <div>
              <Art
                src={floorBedroom}
                width={704}
                height={344}
                alt={t("g1ArtAlt")}
                className="ml-auto max-w-[704px] rounded-md"
              />
            </div>
          </div>
        </Container>
      </section>

      <section className={cn("bg-mk-canal text-mk-on-canal", BAND_PADDING)}>
        <Container>
          <div className="grid grid-cols-1 items-start gap-x-[clamp(24px,5vw,72px)] gap-y-9 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]">
            <Reveal>
              <h2 className={BAND_TITLE}>{t("g2Title")}</h2>
              {sentences(2, "mt-5")}
            </Reveal>
            <div>
              <div className="bg-mk-card text-mk-text-strong rounded-t-md pt-[clamp(16px,2.4vw,28px)]">
                <p className="font-mk-heading px-[clamp(16px,2.4vw,28px)] text-[clamp(24px,2.2vw,32px)] leading-[1.2]">
                  {t("uiTitle")}
                </p>
                <ul className="mt-2 flex flex-col">
                  {LENDING_ROWS.map(({ n, cover, tone }) => (
                    <li key={n} className="pt-4">
                      <div className="flex items-end gap-[clamp(12px,2vw,28px)] px-[clamp(16px,2.4vw,28px)]">
                        {/* `sizes` follows the width's clamp: 14vw is 84px at 600px and 208px at 1486px. */}
                        <img
                          src={cover}
                          srcSet={coverSrcSet(cover)}
                          sizes="(min-width: 1486px) 208px, (max-width: 600px) 84px, 14vw"
                          width={480}
                          height={360}
                          alt={t("uiCoverAlt", { title: t(`ui${n}Title`) })}
                          loading="lazy"
                          decoding="async"
                          className="h-auto w-[clamp(84px,14vw,208px)] shrink-0 rounded-t-[2px]"
                        />
                        <div className="min-w-0 flex-1 self-center">
                          <div className="text-[clamp(17px,1.6vw,22px)] leading-snug font-bold">
                            {t(`ui${n}Title`)}
                          </div>
                          <div className="text-mk-text-muted text-[16px] leading-snug min-[860px]:text-[18px]">
                            {t(`ui${n}Who`)}
                          </div>
                        </div>
                        <span
                          className={cn(
                            "shrink-0 self-center rounded-sm px-2.5 py-1 text-[14px] font-semibold min-[860px]:text-[16px]",
                            tone,
                          )}
                        >
                          {t(`ui${n}Status`)}
                        </span>
                      </div>
                      <div className="bg-mk-plank h-[9px]" />
                    </li>
                  ))}
                </ul>
                <div className="h-4" />
              </div>
            </div>
          </div>
        </Container>
      </section>

      <section className={cn("bg-mk-gold text-mk-on-gold", BAND_PADDING)}>
        <Container>
          <div className="grid grid-cols-1 items-start gap-x-[clamp(24px,5vw,72px)] gap-y-9 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
            <Reveal className="lg:order-2">
              <h2 className={BAND_TITLE}>{t("g3Title")}</h2>
              {sentences(3, "mt-5")}
            </Reveal>
            <div className="lg:order-1">
              <div className="bg-mk-card text-mk-text-strong rounded-md p-[clamp(16px,2.4vw,28px)] pb-0">
                <p className="text-mk-text-muted text-[16px]">
                  {t("sampleLabel")}
                </p>
                <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
                  {SAMPLE_FILTERS.map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-mk-text-muted text-[16px]">
                        {t(label)}
                      </dt>
                      <dd className="text-[18px] font-bold">{t(value)}</dd>
                    </div>
                  ))}
                </dl>
                <ul className="-mx-[clamp(16px,2.4vw,28px)] mt-6 grid grid-cols-2">
                  {SAMPLE_RESULTS.map((r) => (
                    <li key={r.title} className="flex flex-col">
                      <div className="flex flex-1 items-end px-[clamp(16px,2.4vw,28px)]">
                        {/* `sizes` follows the width's clamp: 14vw is 120px at 857px and 208px at 1486px. */}
                        <img
                          src={r.cover}
                          srcSet={coverSrcSet(r.cover)}
                          sizes="(min-width: 1486px) 208px, (max-width: 857px) 120px, 14vw"
                          width={480}
                          height={360}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          className="h-auto w-[clamp(120px,14vw,208px)] rounded-t-[2px]"
                        />
                      </div>
                      <div className="bg-mk-plank h-[9px]" />
                      <p className="px-[clamp(16px,2.4vw,28px)] pt-2.5 pb-4 text-[16px] leading-snug">
                        <span className="block text-[17px] font-bold">
                          {r.title}
                        </span>
                        {t("sampleOwner", { name: r.owner })}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </Container>
      </section>

      <section className={cn("bg-mk-bg text-mk-text-strong", BAND_PADDING)}>
        <Container>
          <div className="grid grid-cols-1 items-center gap-x-[clamp(24px,5vw,72px)] gap-y-7 md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
            <div>
              <Art
                src={windowsHandover}
                width={840}
                height={372}
                alt={t("g4ArtAlt")}
                className="max-w-[840px] rounded-md"
              />
            </div>
            <Reveal>
              <h2 className={BAND_TITLE}>{t("g4Title")}</h2>
              {sentences(4, "mt-5")}
            </Reveal>
          </div>
        </Container>
      </section>

      <section className="bg-mk-sky text-mk-text-strong">
        <Container className="relative py-[clamp(56px,7vw,96px)]">
          <h2 className={BAND_TITLE}>{t("ctaTitle")}</h2>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button variant="brand" size="public" asChild>
              <Link href={start.href}>{start.label}</Link>
            </Button>
            <Button variant="default" size="public" asChild>
              <Link href="/about">{t("ctaAbout")}</Link>
            </Button>
          </div>
          <StreetSkyline className="text-mk-canal absolute right-10 bottom-0 h-[120px] w-[480px] dark:[--skyline-window:var(--mk-gold)] max-lg:hidden" />
        </Container>
      </section>
    </main>
  );
}
