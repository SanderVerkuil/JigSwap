import { Link } from "@/compat/link";
import kitchenTable from "@/components/marketing/assets/art/kitchen-table.webp";
import { kitchenTableSrcSet } from "@/components/marketing/assets/art/renditions";
import { EDGE, TEXT_LINK } from "@/components/marketing/home/classes";
import { Reveal } from "@/components/marketing/reveal";
import { cn } from "@/lib/utils";
import { useTranslations } from "use-intl";

// The family's own word, on the sky-soft band: their kitchen table across the full width, standing on
// its ledge and never taller than the screen, then the point on the left and their quote, as they wrote
// it, on the right.
export function Sustain() {
  const t = useTranslations("marketing.home");
  return (
    <section className="bg-mk-sky-soft pb-[clamp(56px,8vw,120px)] text-mk-text-strong">
      {/* On a phone the 16:9 crop shows the table at about 150vw wide. Wider, the box keeps the
          picture's own shape before it loads, so the page doesn't grow under the reader. */}
      <img
        src={kitchenTable}
        srcSet={kitchenTableSrcSet}
        sizes="(max-width: 759px) 150vw, 100vw"
        alt={t("sustain.tableAlt")}
        width={2400}
        height={903}
        loading="lazy"
        decoding="async"
        className="block aspect-[16/9] h-auto w-full object-cover object-[38%_50%] min-[760px]:aspect-[2400/903] min-[760px]:max-h-[85svh]"
      />
      <div className="h-3.5 bg-mk-plank" />
      <div
        className={cn(
          EDGE,
          "mt-10 grid gap-8 min-[860px]:mt-16 min-[860px]:grid-cols-12 min-[860px]:gap-x-6",
        )}
      >
        <Reveal rise={20} className="min-[860px]:col-span-5">
          <h2 className="font-mk-heading text-[clamp(30px,3.6vw,52px)] leading-[1.08] font-normal text-balance">
            {t("sustain.title")}
          </h2>
          <p className="mt-4 max-w-[46ch] text-[18px] leading-[1.5] text-pretty">
            {t("sustain.body")}
          </p>
        </Reveal>
        <div className="min-[860px]:col-span-7">
          <blockquote className="font-mk-heading text-[clamp(24px,2.5vw,36px)] leading-[1.28]">
            {t("quote.text")}
          </blockquote>
          <p className="mt-6 text-[17px] font-bold">{t("quote.name")}</p>
          <p className="text-[16px] text-mk-text-muted">{t("quote.sub")}</p>
          <Link
            href="/contact"
            className={cn(
              TEXT_LINK,
              "mt-4 inline-flex min-h-11 items-center text-[18px]",
            )}
          >
            {t("sustain.contact")}
          </Link>
        </div>
      </div>
    </section>
  );
}
