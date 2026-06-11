import { Link } from "@/compat/link";
import { type PlankBox } from "@/components/marketing/plank";
import { JigPlank3D } from "@/components/marketing/plank-3d";
import { Reveal } from "@/components/marketing/reveal";
import { Eyebrow } from "@/components/marketing/section";
import { Button } from "@/components/ui/button";
import { gateway } from "@/gateway";
import { useQuery } from "convex/react";
import { ArrowRight } from "lucide-react";
import { useFormatter, useTranslations } from "use-intl";

import coverSand from "@/components/marketing/assets/cover-sand.jpg";

// Boxes for the signature PuzzlePlank — themed brand colours + one real cover.
// Decorative props (puzzle titles stay the same across locales, per the design).
const PLANK_WIDE: PlankBox[] = [
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
  {
    series: "Natuur",
    title: "Waddenzee",
    pieceCount: 500,
    c1: "var(--mk-green-300)",
    c2: "var(--mk-green-600)",
    width: 90,
  },
  {
    series: "Steden",
    title: "Rotterdam",
    pieceCount: 1000,
    c1: "var(--mk-violet-300)",
    c2: "var(--mk-violet-700)",
    width: 104,
  },
  {
    series: "Kunst",
    title: "De Melkmeid",
    pieceCount: 1500,
    c1: "var(--mk-pink-300)",
    c2: "var(--mk-pink-500)",
    width: 98,
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

// ---------------------------------------------------------------------------
// Hero — full-bleed 3D backdrop
// The puzzle plank covers the entire hero background. A readability scrim
// (horizontal + bottom fade) sits above the canvas so text stays legible.
// ---------------------------------------------------------------------------

export function Hero() {
  const t = useTranslations("marketing.home");
  return (
    <div className="relative overflow-hidden">
      <div className="mk-hero-glow" />

      {/* Full-bleed 3D backdrop layer */}
      <div className="absolute inset-0" aria-hidden="true">
        <JigPlank3D boxes={PLANK_WIDE} />
      </div>

      {/* Readability scrim: horizontal fade for the text side + bottom fade so
          the scene melts into the next section. Works in light and dark modes
          via color-mix over the bg token. */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(90deg, var(--mk-bg) 25%, color-mix(in oklab, var(--mk-bg) 55%, transparent) 55%, transparent 78%), linear-gradient(180deg, transparent 55%, color-mix(in oklab, var(--mk-bg) 70%, transparent) 100%)",
          pointerEvents: "none",
          zIndex: 1,
        }}
      />

      {/* Text content — sits above the scrim */}
      <div
        className="relative w-full max-w-[1200px] mx-auto px-6"
        style={{ zIndex: 2 }}
      >
        <div className="max-w-[560px] min-h-[520px] pt-[clamp(48px,7vw,100px)] pb-[clamp(64px,8vw,112px)]">
          <Reveal>
            <Eyebrow>{t("eyebrow")}</Eyebrow>
            <h1 className="font-mk-heading font-bold tracking-tight text-mk-text-strong text-[clamp(38px,6vw,62px)] leading-[1.04] mt-[18px]">
              {t("heroTitle")}
            </h1>
            <p className="text-[clamp(17px,1.4vw,20px)] leading-relaxed text-mk-text-muted mt-[22px] max-w-[520px] text-pretty">
              {t("heroLead")}
            </p>
            <HeroCTAs />
            <TrustRow />
          </Reveal>
        </div>
      </div>
    </div>
  );
}
