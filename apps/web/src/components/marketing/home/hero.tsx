import { Link } from "@/compat/link";
import { type PlankBox } from "@/components/marketing/plank";
import { JigPlank3D } from "@/components/marketing/plank-3d";
import { Reveal } from "@/components/marketing/reveal";
import { Eyebrow } from "@/components/marketing/section";
import { Button } from "@/components/ui/button";
import { gateway } from "@/gateway";
import { useQuery } from "convex/react";
import { ArrowRight } from "lucide-react";
import * as React from "react";
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

// Extended box list for the stage variant — wider shelf needs more boxes to
// avoid looking sparse. Same decorative Dutch titles, brand color vars.
const PLANK_WIDE: PlankBox[] = [
  ...PLANK,
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
// Hero variant types
// ---------------------------------------------------------------------------

type HeroVariant = "classic" | "stage" | "backdrop" | "float";

const DRAFT_STORAGE_KEY = "jigswap-hero-draft";

// ---------------------------------------------------------------------------
// Variant 1: classic — refined split (baseline)
// 2-col grid layout; plank gets more presence at scale .84.
// ---------------------------------------------------------------------------

function HeroClassic() {
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
              <div className="scale-[.84] origin-center">
                <JigPlank3D key="classic" boxes={PLANK} preset="side" />
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Variant 2: stage — full-width shelf stage
// Single column; text centered; plank spans the full hero width below.
// ---------------------------------------------------------------------------

function HeroStage() {
  const t = useTranslations("marketing.home");
  return (
    <div className="relative overflow-hidden">
      <div className="mk-hero-glow" />
      <div className="relative w-full max-w-[1200px] mx-auto px-6">
        <div className="flex flex-col items-center pt-[clamp(48px,7vw,96px)] pb-[clamp(56px,6vw,80px)]">
          <Reveal className="text-center max-w-[720px] mx-auto">
            <Eyebrow center>{t("eyebrow")}</Eyebrow>
            <h1 className="font-mk-heading font-bold tracking-tight text-mk-text-strong text-[clamp(38px,5.5vw,64px)] leading-[1.04] mt-[18px]">
              {t("heroTitle")}
            </h1>
            <p className="text-[clamp(17px,1.4vw,20px)] leading-relaxed text-mk-text-muted mt-[22px] text-pretty">
              {t("heroLead")}
            </p>
            <div className="flex justify-center">
              <HeroCTAs />
            </div>
            <div className="flex justify-center">
              <TrustRow />
            </div>
          </Reveal>
          <Reveal
            delay={160}
            className="w-full mt-[clamp(40px,6vw,72px)] overflow-visible"
            style={{ maxHeight: 340 }}
          >
            <JigPlank3D key="stage" boxes={PLANK_WIDE} preset="stage" />
          </Reveal>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Variant 3: backdrop — environmental
// Plank is an absolutely-positioned background element right-aligned behind
// the text. A readability scrim sits between them.
// ---------------------------------------------------------------------------

function HeroBackdrop() {
  const t = useTranslations("marketing.home");
  return (
    <div className="relative overflow-hidden">
      <div className="mk-hero-glow" />
      {/* Plank sits in the background, right-aligned, vertically centred */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          right: "-4%",
          width: "68%",
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          pointerEvents: "none",
          zIndex: 0,
        }}
      >
        <div style={{ width: "100%" }}>
          <JigPlank3D key="backdrop" boxes={PLANK} preset="backdrop" />
        </div>
      </div>
      {/* Readability scrim: bg token on the left fading to transparent on the
          right. Uses color-mix so both light and dark mode get the correct bg. */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(90deg, var(--mk-bg) 35%, color-mix(in oklab, var(--mk-bg) 60%, transparent) 65%, transparent 80%)",
          pointerEvents: "none",
          zIndex: 1,
        }}
      />
      {/* Text content sits above the scrim */}
      <div
        className="relative w-full max-w-[1200px] mx-auto px-6"
        style={{ zIndex: 2 }}
      >
        <div className="max-w-[560px] pt-[clamp(48px,7vw,100px)] pb-[clamp(64px,8vw,112px)]">
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

// ---------------------------------------------------------------------------
// Variant 4: float — weightless
// 2-col like classic, but preset="float" (boxes float without a shelf, gentle
// bob). Scale .9 for more presence.
// ---------------------------------------------------------------------------

function HeroFloat() {
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
              <div className="scale-[.9] origin-center">
                <JigPlank3D key="float" boxes={PLANK} preset="float" />
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Floating compare toggle
// Temporary draft tool for design comparison — NOT for production.
// Persists selection in localStorage; SSR-safe (defaults to "classic").
// ---------------------------------------------------------------------------

const VARIANT_LABELS: { id: HeroVariant; label: string }[] = [
  { id: "classic", label: "Classic" },
  { id: "stage", label: "Stage" },
  { id: "backdrop", label: "Backdrop" },
  { id: "float", label: "Float" },
];

function DraftToggle({
  active,
  onChange,
}: {
  active: HeroVariant;
  onChange: (v: HeroVariant) => void;
}) {
  return (
    // DRAFT TOOL: temporary floating UI for hero variant comparison. Remove before shipping.
    <div
      style={{
        position: "fixed",
        // sits above the cookie-consent banner (fixed bottom, z-50)
        bottom: 18,
        right: 18,
        zIndex: 60,
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "4px 6px",
        borderRadius: 9999,
        background: "var(--mk-card)",
        border: "1px solid var(--mk-border)",
        boxShadow: "var(--shadow-mk-lg)",
      }}
    >
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: ".06em",
          textTransform: "uppercase",
          color: "var(--mk-text-muted)",
          paddingLeft: 6,
          paddingRight: 4,
          userSelect: "none",
        }}
      >
        Hero draft
      </span>
      {VARIANT_LABELS.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          style={{
            height: 30,
            padding: "0 12px",
            borderRadius: 9999,
            fontSize: 13,
            fontWeight: 600,
            border: "none",
            cursor: "pointer",
            transition: "background .15s ease, color .15s ease",
            background: active === id ? "var(--mk-violet-400)" : "transparent",
            color: active === id ? "#fff" : "var(--mk-text-strong)",
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hero — exported component with draft variant switcher
// ---------------------------------------------------------------------------

export function Hero() {
  // Default to "classic" on the server to avoid hydration mismatch.
  const [variant, setVariant] = React.useState<HeroVariant>("classic");

  // On the client, sync from localStorage after first paint.
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(DRAFT_STORAGE_KEY);
    if (
      stored === "classic" ||
      stored === "stage" ||
      stored === "backdrop" ||
      stored === "float"
    ) {
      setVariant(stored);
    }
  }, []);

  const handleChange = (v: HeroVariant) => {
    setVariant(v);
    try {
      window.localStorage.setItem(DRAFT_STORAGE_KEY, v);
    } catch {
      // localStorage may be unavailable in some environments; ignore silently.
    }
  };

  return (
    <>
      {variant === "classic" && <HeroClassic />}
      {variant === "stage" && <HeroStage />}
      {variant === "backdrop" && <HeroBackdrop />}
      {variant === "float" && <HeroFloat />}
      <DraftToggle active={variant} onChange={handleChange} />
    </>
  );
}
