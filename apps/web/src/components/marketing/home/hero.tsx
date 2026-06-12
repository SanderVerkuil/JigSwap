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

import coverSand from "@/components/marketing/assets/cover-sand.webp";

// Fallback boxes for the signature PuzzlePlank — used during loading and when
// the catalog has fewer than 3 puzzles. Themed brand colours + one real cover.
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
  // The real-cover box: index 3 deals onto the bottom row (3 % SHELF_ROWS),
  // where the gallery spots and contact shadows keep it prominent.
  { cover: coverSand, title: "Zandsculpturen", width: 134 },
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
  {
    series: "Natuur",
    title: "Keukenhof",
    pieceCount: 1000,
    c1: "var(--mk-green-400)",
    c2: "var(--mk-green-600)",
    width: 112,
  },
  {
    series: "Steden",
    title: "Utrecht",
    pieceCount: 750,
    c1: "var(--mk-violet-400)",
    c2: "var(--mk-violet-600)",
    width: 94,
  },
  {
    series: "Kunst",
    title: "De Nachtwacht",
    pieceCount: 2000,
    c1: "var(--mk-pink-400)",
    c2: "var(--mk-pink-500)",
    width: 118,
  },
  {
    series: "Natuur",
    title: "Hoge Veluwe",
    pieceCount: 1500,
    c1: "var(--mk-green-300)",
    c2: "var(--mk-green-600)",
    width: 102,
  },
  {
    series: "Steden",
    title: "Giethoorn",
    pieceCount: 500,
    c1: "var(--mk-violet-300)",
    c2: "var(--mk-violet-700)",
    width: 88,
  },
  {
    series: "Kunst",
    title: "Delfts Blauw",
    pieceCount: 1000,
    c1: "var(--mk-pink-300)",
    c2: "var(--mk-pink-500)",
    width: 106,
  },
  {
    series: "Natuur",
    title: "Kinderdijk",
    pieceCount: 1500,
    c1: "var(--mk-green-400)",
    c2: "var(--mk-green-600)",
    width: 96,
  },
];

const WIDTHS = [100, 134, 96, 108, 90, 104, 98] as const;
const COLOR_PAIRS: Array<[string, string]> = [
  ["var(--mk-violet-400)", "var(--mk-violet-600)"],
  ["var(--mk-green-400)", "var(--mk-green-600)"],
  ["var(--mk-pink-400)", "var(--mk-pink-500)"],
  ["var(--mk-violet-300)", "var(--mk-violet-700)"],
];

// Number of stacked shelf rows in the 3D backdrop (and the CSS fallback).
const SHELF_ROWS = 3;

// Deal boxes round-robin across the shelf rows so each row gets its own mix
// of colours and covers; the 3D scene cycles each row's list to fill the
// visible span, so a handful of unique boxes per row is enough.
function toRows(boxes: PlankBox[]): PlankBox[][] {
  const rows: PlankBox[][] = Array.from({ length: SHELF_ROWS }, () => []);
  boxes.forEach((box, i) => rows[i % SHELF_ROWS].push(box));
  return rows;
}

type PlankPuzzleView = {
  title: string;
  pieceCount: number;
  brand?: string;
  image: string | null;
};

function toPlankBox(p: PlankPuzzleView, i: number): PlankBox {
  const [c1, c2] = COLOR_PAIRS[i % COLOR_PAIRS.length];
  return {
    title: p.title,
    pieceCount: p.pieceCount,
    series: p.brand,
    cover: p.image ?? undefined,
    width: WIDTHS[i % WIDTHS.length],
    // Only set colors when there is no cover; cover mode ignores them but we
    // pass them for the gradient fallback while the image is loading.
    c1,
    c2,
  };
}

// Minimal local type for the community avatar view — mirrors CommunityAvatarView
// from @jigswap/contracts without importing the package directly.
type CommunityAvatar = { initials: string; image: string | null };

// Decorative placeholders shown during loading and when the community query
// returns no results. These are not real members.
const FALLBACK_AVATARS: Array<[string, string]> = [
  ["MI", "var(--mk-violet-400)"],
  ["TK", "var(--mk-green-500)"],
  ["LV", "var(--mk-pink-400)"],
  ["RJ", "var(--mk-violet-600)"],
];

const AVATAR_COLORS = [
  "var(--mk-violet-400)",
  "var(--mk-green-500)",
  "var(--mk-pink-400)",
  "var(--mk-violet-600)",
] as const;

// Real member count instead of the prototype's invented "4.200+".
function TrustRow() {
  const t = useTranslations("marketing.home");
  const format = useFormatter();
  const stats = useQuery(gateway.insights.globalStats, {});

  // Stable per-visit seed: generated client-side after mount (SSR-safe).
  // The query is skipped until the seed is ready; FALLBACK_AVATARS fills the
  // cluster meanwhile as a decorative placeholder.
  const [seed, setSeed] = React.useState<number | null>(null);
  React.useEffect(() => setSeed(Math.floor(Math.random() * 0xffffffff)), []);
  const communityAvatars: CommunityAvatar[] | undefined = useQuery(
    gateway.insights.communityAvatars,
    seed === null ? "skip" : { limit: 4, seed },
  );

  // Use live community data when at least one member is returned; otherwise
  // keep the decorative fallback placeholders visible.
  const hasLiveAvatars =
    communityAvatars != null && communityAvatars.length >= 1;

  return (
    <div className="flex items-center gap-3.5 mt-[30px] flex-wrap">
      <div aria-hidden="true" className="flex">
        {hasLiveAvatars
          ? communityAvatars.map((member, i) =>
              member.image != null ? (
                <span
                  key={i}
                  className="w-[38px] h-[38px] rounded-full inline-flex items-center justify-center border-2 border-mk-card overflow-hidden"
                  style={{ marginLeft: i ? -11 : 0 }}
                >
                  <img
                    src={member.image}
                    alt=""
                    className="w-full h-full rounded-full object-cover"
                  />
                </span>
              ) : (
                <span
                  key={i}
                  className="w-[38px] h-[38px] rounded-full text-white font-mk-heading font-semibold text-[13px] inline-flex items-center justify-center border-2 border-mk-card"
                  style={{
                    background: AVATAR_COLORS[i % AVATAR_COLORS.length],
                    marginLeft: i ? -11 : 0,
                  }}
                >
                  {member.initials}
                </span>
              ),
            )
          : FALLBACK_AVATARS.map(([txt, bg], i) => (
              <span
                key={txt}
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

  // Stable per-visit seed: generated client-side after mount (SSR-safe).
  // The query is skipped until the seed is ready; PLANK_WIDE fills the plank
  // meanwhile as a loading fallback.
  const [seed, setSeed] = React.useState<number | null>(null);
  React.useEffect(() => setSeed(Math.floor(Math.random() * 0xffffffff)), []);
  const livePuzzles = useQuery(
    gateway.insights.plankPuzzles,
    // 12 is the backend's clamp ceiling — enough for ~4 unique boxes per
    // shelf row before the scene starts cycling them.
    seed === null ? "skip" : { limit: 12, seed },
  );
  const rows = React.useMemo(
    () =>
      toRows(
        livePuzzles && livePuzzles.length >= 3
          ? livePuzzles.map(toPlankBox)
          : PLANK_WIDE,
      ),
    [livePuzzles],
  );

  return (
    <div className="relative overflow-hidden">
      <div className="mk-hero-glow" />

      {/* Full-bleed 3D backdrop layer */}
      <div className="absolute inset-0" aria-hidden="true">
        <JigPlank3D rows={rows} />
      </div>

      {/* Readability scrim: horizontal fade for the text side + bottom fade so
          the scene melts into the next section. Works in light and dark modes
          via color-mix over the bg token. Softened first stop so the frosted
          panel behind the text provides its own local contrast. */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(90deg, color-mix(in oklab, var(--mk-bg) 78%, transparent) 22%, color-mix(in oklab, var(--mk-bg) 55%, transparent) 55%, transparent 78%), linear-gradient(180deg, transparent 55%, color-mix(in oklab, var(--mk-bg) 70%, transparent) 100%)",
          pointerEvents: "none",
          zIndex: 1,
        }}
      />

      {/* Text content — sits above the scrim */}
      <div
        className="relative w-full max-w-[1200px] mx-auto px-6"
        style={{ zIndex: 2 }}
      >
        <div className="min-h-[520px] pt-[clamp(48px,7vw,100px)] pb-[clamp(64px,8vw,112px)]">
          {/* Frosted-glass callout — provides local contrast behind the hero
              text. Borderless and shadowless so it reads as part of the page
              rather than a floating card. */}
          <div
            className="max-w-[640px] rounded-3xl"
            style={{
              background: "color-mix(in oklab, var(--mk-bg) 58%, transparent)",
              backdropFilter: "blur(9px)",
              WebkitBackdropFilter: "blur(9px)",
              padding: "clamp(24px, 3.5vw, 44px)",
            }}
          >
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
    </div>
  );
}
