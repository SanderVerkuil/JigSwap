import { Link } from "@/compat/link";
import { Eyebrow } from "@/components/marketing/section";
import { JigPlank, type PlankBox } from "@/components/marketing/plank";
import { Reveal } from "@/components/marketing/reveal";
import { Button } from "@/components/ui/button";
import { gateway } from "@/gateway";
import { ArrowRight } from "lucide-react";
import { useQuery } from "convex/react";
import { useFormatter, useTranslations } from "use-intl";

import coverSand from "@/components/marketing/assets/cover-sand.jpg";

// Boxes for the signature PuzzlePlank — themed brand colours + one real cover.
// Decorative props (puzzle titles stay the same across locales, per the design).
const PLANK: PlankBox[] = [
  {
    series: "Natuur",
    title: "Boslicht",
    pieceCount: 1000,
    c1: "var(--mk-violet-400)",
    c2: "var(--mk-violet-600)",
    width: 100,
  },
  { cover: coverSand, title: "Zandsculpturen", width: 134 },
  {
    series: "Steden",
    title: "Amsterdam",
    pieceCount: 1500,
    c1: "var(--mk-green-400)",
    c2: "var(--mk-green-600)",
    width: 96,
  },
  {
    series: "Kunst",
    title: "Sterrennacht",
    pieceCount: 2000,
    c1: "var(--mk-pink-400)",
    c2: "var(--mk-pink-500)",
    width: 108,
  },
];

const AVATARS: Array<[string, string]> = [
  ["MI", "var(--mk-violet-400)"],
  ["TK", "var(--mk-green-500)"],
  ["LV", "var(--mk-pink-400)"],
  ["RJ", "var(--mk-violet-600)"],
];

// Real member count instead of the prototype's invented "4.200+".
function TrustRow() {
  const t = useTranslations("marketing.home");
  const format = useFormatter();
  const stats = useQuery(gateway.insights.globalStats, {});
  return (
    <div className="flex items-center gap-3.5 mt-[30px] flex-wrap">
      <div className="flex">
        {AVATARS.map(([txt, bg], i) => (
          <span
            key={txt}
            aria-hidden="true"
            className="w-[38px] h-[38px] rounded-full text-white font-mk-heading font-semibold text-[13px] inline-flex items-center justify-center border-2 border-mk-card"
            style={{ background: bg, marginLeft: i ? -11 : 0 }}
          >
            {txt}
          </span>
        ))}
      </div>
      {stats != null && (
        <div className="text-[14.5px] text-mk-text-muted leading-snug">
          {t("trustRow", { count: format.number(stats.totalUsers) })}
        </div>
      )}
    </div>
  );
}

function HeroCTAs() {
  const t = useTranslations("marketing");
  return (
    <div className="flex gap-3 flex-wrap mt-[30px]">
      <Button variant="brand" className="h-11 px-6 text-[15px]" asChild>
        <Link href="/sign-up">
          {t("nav.startTrading")}
          <ArrowRight size={17} />
        </Link>
      </Button>
      <Button
        variant="outline"
        className="h-11 px-6 text-[15px] bg-mk-card border-mk-border text-mk-text-strong hover:bg-mk-muted"
        asChild
      >
        <Link href="/features">{t("home.seeFeatures")}</Link>
      </Button>
    </div>
  );
}

// Hero — the design's "plank" variant: split layout with the 3D shelf.
export function Hero() {
  const t = useTranslations("marketing.home");
  return (
    <div className="relative overflow-hidden">
      <div className="mk-hero-glow" />
      <div className="relative w-full max-w-[1200px] mx-auto px-6">
        <div className="grid grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] max-[860px]:grid-cols-1 gap-12 items-center pt-[clamp(40px,6vw,84px)] pb-[clamp(60px,7vw,96px)]">
          <Reveal>
            <Eyebrow>{t("eyebrow")}</Eyebrow>
            <h1 className="font-mk-heading font-bold tracking-tight text-mk-text-strong text-[clamp(38px,6vw,62px)] leading-[1.04] mt-[18px]">
              {t("heroTitle")}
            </h1>
            <p className="text-[clamp(17px,1.4vw,20px)] leading-relaxed text-mk-text-muted mt-[22px] max-w-[540px] text-pretty">
              {t("heroLead")}
            </p>
            <HeroCTAs />
            <TrustRow />
          </Reveal>
          <Reveal delay={120} className="flex justify-center">
            <div className="max-w-full max-[860px]:scale-[.84] max-[540px]:scale-[.66]">
              <div className="scale-[.74] origin-center [filter:drop-shadow(0_30px_40px_rgb(40_30_80_/_.16))]">
                <JigPlank boxes={PLANK} depth={18} />
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </div>
  );
}
