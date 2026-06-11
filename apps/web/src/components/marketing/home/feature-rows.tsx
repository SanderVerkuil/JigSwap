import { MkBadge, type MkBadgeTone } from "@/components/marketing/badge";
import { Container } from "@/components/marketing/container";
import { JigPlank } from "@/components/marketing/plank";
import { Reveal } from "@/components/marketing/reveal";
import { Eyebrow, Section } from "@/components/marketing/section";
import { Check } from "lucide-react";
import * as React from "react";
import { useTranslations } from "use-intl";

import coverSand from "@/components/marketing/assets/cover-sand.jpg";

// Alternating feature rows (open layout, no cards — per the design system's
// "cards are a last resort" rule). Copy is aligned with shipped features:
// custody tracking says WHO has a box (no live location), recall sends an
// in-app notification (not email), and discovery has no distance filter.
export function FeatureRows() {
  const t = useTranslations("marketing.home.rows");

  const rows: Array<{
    key: "library" | "lend" | "discover";
    visual: React.ReactNode;
    reverse?: boolean;
  }> = [
    {
      key: "library",
      visual: (
        <JigPlank
          depth={16}
          boxes={[
            {
              series: "Natuur",
              title: "Boslicht",
              pieceCount: 1000,
              c1: "var(--mk-violet-400)",
              c2: "var(--mk-violet-600)",
              width: 96,
            },
            { cover: coverSand, title: "Zandsculpturen", width: 128 },
            {
              series: "Kunst",
              title: "Sterrennacht",
              pieceCount: 2000,
              c1: "var(--mk-pink-400)",
              c2: "var(--mk-pink-500)",
              width: 100,
            },
          ]}
        />
      ),
    },
    { key: "lend", visual: <LendTrackVisual />, reverse: true },
    { key: "discover", visual: <FilterVisual /> },
  ];

  return (
    <Section>
      <Container>
        <div className="flex flex-col gap-[clamp(56px,8vw,104px)]">
          {rows.map((r) => (
            <Reveal key={r.key}>
              <div className="grid grid-cols-2 max-[860px]:grid-cols-1 gap-[clamp(32px,5vw,72px)] items-center">
                <div className={r.reverse ? "order-2 max-[860px]:order-none" : ""}>
                  <Eyebrow>{t(`${r.key}Eyebrow`)}</Eyebrow>
                  <h3 className="font-mk-heading font-bold tracking-tight text-[clamp(26px,3.4vw,36px)] mt-3.5 leading-[1.12] text-mk-text-strong">
                    {t(`${r.key}Title`)}
                  </h3>
                  <p className="text-[17px] leading-relaxed text-mk-text-muted mt-4 text-pretty">
                    {t(`${r.key}Body`)}
                  </p>
                  <ul className="mt-[22px] flex flex-col gap-3">
                    {([1, 2, 3] as const).map((n) => (
                      <li
                        key={n}
                        className="flex items-center gap-[11px] text-[15.5px] text-mk-text-body"
                      >
                        <span className="w-6 h-6 rounded-full bg-mk-green-100 text-mk-green-700 inline-flex items-center justify-center shrink-0">
                          <Check size={14} />
                        </span>
                        {t(`${r.key}Point${n}`)}
                      </li>
                    ))}
                  </ul>
                </div>
                <div
                  className={
                    "flex justify-center " +
                    (r.reverse ? "order-1 max-[860px]:order-none" : "")
                  }
                >
                  <div className="w-full min-h-[230px] flex items-center justify-center py-2">
                    {r.visual}
                  </div>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </Container>
    </Section>
  );
}

// Illustrative filter chips — every chip mirrors a real browse filter
// (piece count, difficulty, condition, availability).
function FilterVisual() {
  const t = useTranslations("marketing.home.visual");
  const chips: Array<[string, MkBadgeTone]> = [
    [t("chipPieces"), "secondary"],
    [t("chipMedium"), "medium"],
    [t("chipLikeNew"), "secondary"],
    [t("chipAvailable"), "success"],
    [t("chipHard"), "hard"],
  ];
  return (
    <div className="flex flex-wrap gap-2.5 justify-center max-w-[320px]">
      {chips.map(([txt, tone]) => (
        <MkBadge key={txt} tone={tone} className="text-[13px] px-3 py-1.5">
          {txt}
        </MkBadge>
      ))}
    </div>
  );
}

// "My puzzles" custody snapshot: available / lent out / recalled.
function LendTrackVisual() {
  const t = useTranslations("marketing.home.visual");
  const rows: Array<{
    initial: string;
    color: string;
    title: string;
    sub: string;
    status: string;
    tone: MkBadgeTone;
  }> = [
    {
      initial: "MI",
      color: "var(--mk-green-500)",
      title: "Boslicht",
      sub: t("onYourShelf"),
      status: t("available"),
      tone: "success",
    },
    {
      initial: "TK",
      color: "var(--mk-violet-400)",
      title: "Sterrennacht",
      sub: t("withName", { name: "Tom" }),
      status: t("lentOut"),
      tone: "secondary",
    },
    {
      initial: "RJ",
      color: "var(--mk-pink-400)",
      title: "Amsterdam",
      sub: t("notificationSent"),
      status: t("recalled"),
      tone: "warning",
    },
  ];
  return (
    <div className="w-full max-w-[360px] bg-mk-card border border-mk-border rounded-[14px] shadow-mk-sm overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-mk-border">
        <span className="font-mk-heading font-semibold text-[15px] text-mk-text-strong whitespace-nowrap">
          {t("myPuzzles")}
        </span>
        <span className="font-mono text-xs text-mk-text-muted">
          {t("puzzlesCount", { count: 3 })}
        </span>
      </div>
      <div className="flex flex-col">
        {rows.map((r, i) => (
          <div
            key={r.title}
            className={
              "flex items-center gap-3 px-4 py-3 " +
              (i < rows.length - 1 ? "border-b border-mk-border" : "")
            }
          >
            <span
              className="w-[34px] h-[34px] shrink-0 rounded-full text-white font-mk-heading font-semibold text-xs inline-flex items-center justify-center"
              style={{ background: r.color }}
            >
              {r.initial}
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-sm text-mk-text-strong truncate">
                {r.title}
              </div>
              <div className="text-[12.5px] text-mk-text-muted">{r.sub}</div>
            </div>
            <MkBadge tone={r.tone} className="shrink-0">
              {r.status}
            </MkBadge>
          </div>
        ))}
      </div>
    </div>
  );
}
