import amsterdam from "@/components/marketing/assets/art/covers/amsterdam.webp";
import bruggetje from "@/components/marketing/assets/art/covers/bruggetje.webp";
import burenpraat from "@/components/marketing/assets/art/covers/burenpraat.webp";
import deRen from "@/components/marketing/assets/art/covers/de-ren.webp";
import dorpsstraat from "@/components/marketing/assets/art/covers/dorpsstraat.webp";
import eendenvijver from "@/components/marketing/assets/art/covers/eendenvijver.webp";
import grachtje from "@/components/marketing/assets/art/covers/grachtje.webp";
import kruiwagen from "@/components/marketing/assets/art/covers/kruiwagen.webp";
import limonade from "@/components/marketing/assets/art/covers/limonade.webp";
import molen from "@/components/marketing/assets/art/covers/molen.webp";
import picknick from "@/components/marketing/assets/art/covers/picknick.webp";
import puzzelmiddag from "@/components/marketing/assets/art/covers/puzzelmiddag.webp";
import theekoepel from "@/components/marketing/assets/art/covers/theekoepel.webp";
import tulpen from "@/components/marketing/assets/art/covers/tulpen.webp";
import bridge from "@/components/marketing/assets/art/crops/bridge.webp";
import { MkBadge, type MkBadgeTone } from "@/components/marketing/badge";
import { Reveal } from "@/components/marketing/reveal";
import { cn } from "@/lib/utils";
import * as React from "react";
import { useTranslations } from "use-intl";

// Three capabilities as storeys of the house: full-width colour sheets that stack as you scroll, each
// sliding over the last and leaving its title band in view. The sticky header is 64px tall, so every
// offset starts there. Each sheet's bottom edge sits on the viewport's, so the stack leaves as one and
// the last sheet never rides up over the earlier bands. The copy stands directly under the title, and a
// hold of 40svh below each sheet keeps it pinned for that long before the next one arrives. A stuck
// sheet needs the room, so the stack waits for 860px of width and 720px of height; below that the
// storeys simply follow each other at their natural height.
//
// Each storey has its own composition: a wall of boxes on plank ledges around the copy, the custody
// list dominating the green sheet, and the marigold sheet setting its sentence beside the title above
// the park.
const HEADER = 64;
const BAND = 72;

const STOREY_CLASS =
  "top-(--top) flex flex-col min-[860px]:h-[calc(100svh-var(--top))] min-[860px]:min-h-[480px] min-[860px]:[@media(min-height:720px)]:sticky";

// The hold: empty scroll room after each sheet. A sibling and not a margin, so every stuck sheet's box
// keeps ending on the viewport's edge and the stack lets go all at once.
const HOLD = (
  <div
    aria-hidden="true"
    className="hidden h-[40svh] min-[860px]:[@media(min-height:720px)]:block"
  />
);

const BAND_TITLE =
  "flex h-[52px] shrink-0 items-center px-4 font-mk-heading text-[22px] leading-none font-normal min-[760px]:px-10 min-[860px]:h-[72px] min-[860px]:text-[clamp(28px,3vw,44px)]";

const COPY =
  "max-w-[40ch] px-4 pt-1 pb-5 text-[18px] leading-[1.45] text-pretty min-[760px]:px-10 min-[860px]:pt-0 min-[860px]:pb-6 min-[860px]:text-[20px]";

export function FeatureRows() {
  const t = useTranslations("marketing.home");

  const offsets = (i: number) =>
    ({
      "--top": `${HEADER + BAND * i}px`,
    }) as React.CSSProperties;

  return (
    <section>
      <article
        className={cn(STOREY_CLASS, "bg-mk-sky text-mk-text-strong")}
        style={offsets(0)}
      >
        <h2 className={BAND_TITLE}>{t("rows.libraryTitle")}</h2>
        <ShelfWall
          intro={
            <Reveal rise={20} delay={70}>
              <p className="max-w-[40ch] px-4 pt-1 text-[18px] leading-[1.45] text-pretty min-[760px]:px-10 min-[860px]:pt-0 min-[1180px]:text-[20px] min-[1180px]:[@media(max-height:820px)]:text-[18px]">
                {t("rows.libraryBody")}
              </p>
              <p className="px-4 pt-2 pb-5 text-[16px] min-[760px]:px-10">
                {t("exampleShelf")}
              </p>
            </Reveal>
          }
        />
      </article>
      {HOLD}

      <article
        className={cn(STOREY_CLASS, "bg-mk-canal text-mk-on-canal")}
        style={offsets(1)}
      >
        <h2 className={BAND_TITLE}>{t("rows.lendTitle")}</h2>
        <div className="flex min-h-0 flex-1 flex-col min-[860px]:grid min-[860px]:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] min-[860px]:items-start">
          <Reveal rise={20} delay={70}>
            <p className={COPY}>{t("rows.lendBody")}</p>
          </Reveal>
          <Reveal rise={16} delay={140} className="max-[859px]:flex-1">
            <LendTrackVisual />
          </Reveal>
        </div>
      </article>
      {HOLD}

      <article
        className={cn(STOREY_CLASS, "bg-mk-gold text-mk-on-gold")}
        style={offsets(2)}
      >
        <div className="min-[860px]:grid min-[860px]:grid-cols-2">
          <h2 className={BAND_TITLE}>{t("rows.discoverTitle")}</h2>
          <Reveal rise={20} delay={70}>
            <p className="max-w-[44ch] px-4 pt-1 pb-5 text-[18px] leading-[1.4] text-pretty min-[760px]:px-10 min-[860px]:pt-4 min-[860px]:pb-6 min-[860px]:text-[22px]">
              {t("rows.discoverBody")}
            </p>
          </Reveal>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <BridgePicture alt={t("pictures.bridge")} />
        </div>
      </article>
      {HOLD}
    </section>
  );
}

// A wall of boxes, shelves running the sheet's full width with the copy in the top-left cubby. A box's
// size follows its piece count, so the wall reads as real boxes, and leaves headroom under the ledge
// above. On a stuck sheet each row sizes from its height; on a phone the boxes size from the width, and
// only the right-hand boxes show.
type WallBox = { cover: string; title: string; size: number };

const WALL: ReadonlyArray<{ left: WallBox[]; right: WallBox[] }> = [
  {
    left: [],
    right: [
      { cover: dorpsstraat, title: "Dorpsstraat", size: 0.86 },
      { cover: theekoepel, title: "Theekoepel", size: 1 },
      { cover: grachtje, title: "Grachtje", size: 0.72 },
    ],
  },
  {
    left: [
      { cover: picknick, title: "Picknick", size: 1 },
      { cover: limonade, title: "Limonade", size: 0.72 },
    ],
    right: [
      { cover: tulpen, title: "Tulpen", size: 0.86 },
      { cover: burenpraat, title: "Burenpraat", size: 1 },
      { cover: eendenvijver, title: "Eendenvijver", size: 0.86 },
    ],
  },
  {
    left: [
      { cover: bruggetje, title: "Bruggetje", size: 0.86 },
      { cover: deRen, title: "De ren", size: 0.86 },
    ],
    right: [
      { cover: kruiwagen, title: "Kruiwagen", size: 0.72 },
      { cover: amsterdam, title: "Amsterdam", size: 0.86 },
      { cover: puzzelmiddag, title: "Puzzelmiddag", size: 1 },
    ],
  },
];

function WallBoxes({
  boxes,
  className,
}: {
  boxes: WallBox[];
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-0 items-end gap-[2.5%] min-[860px]:h-full",
        className,
      )}
    >
      {boxes.map((box) => (
        <img
          key={box.title}
          src={box.cover}
          alt={box.title}
          width={480}
          height={372}
          loading="lazy"
          decoding="async"
          style={{ "--size": box.size } as React.CSSProperties}
          className="block aspect-[480/372] w-[calc(31%*var(--size))] rounded-t-[2px] border-[3px] border-b-[6px] border-white border-b-mk-canal object-cover min-[860px]:h-[calc(90%*var(--size))] min-[860px]:w-auto min-[860px]:max-w-(--box-max)"
        />
      ))}
    </div>
  );
}

function ShelfWall({ intro }: { intro: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 min-[860px]:grid min-[860px]:min-h-0 min-[860px]:flex-1 min-[860px]:grid-rows-[1.25fr_1fr_1fr] min-[860px]:gap-0">
      {WALL.map((row, i) => (
        <div
          key={row.right[0]?.title}
          className="flex min-h-0 flex-col min-[860px]:h-full"
        >
          <div className="flex min-h-0 flex-1 flex-col min-[860px]:grid min-[860px]:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            {i === 0 ? (
              intro
            ) : (
              <WallBoxes
                boxes={row.left}
                className="hidden px-10 [--box-max:46%] min-[860px]:flex"
              />
            )}
            <WallBoxes
              boxes={row.right}
              className="px-4 [--box-max:31%] min-[760px]:px-10 min-[860px]:px-6"
            />
          </div>
          <div className="h-3 shrink-0 bg-mk-plank" />
        </div>
      ))}
    </div>
  );
}

// The park bridge, drifting very slowly while it is on screen so the children seem to keep walking.
function BridgePicture({ alt }: { alt: string }) {
  const ref = React.useRef<HTMLImageElement>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const drift = el.animate(
      [
        { transform: "scale(1.06) translateX(1.2%)" },
        { transform: "scale(1.06) translateX(-1.2%)" },
      ],
      {
        duration: 22000,
        direction: "alternate",
        iterations: Infinity,
        easing: "ease-in-out",
      },
    );
    drift.pause();
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) drift.play();
      else drift.pause();
    });
    io.observe(el);
    return () => {
      io.disconnect();
      drift.cancel();
    };
  }, []);

  return (
    <img
      ref={ref}
      src={bridge}
      alt={alt}
      width={1536}
      height={558}
      loading="lazy"
      decoding="async"
      className="min-h-0 w-full flex-1 object-cover object-[50%_30%] min-[860px]:object-[50%_60%]"
    />
  );
}

// "My puzzles" custody snapshot: available / lent out / recalled, as the app's list shows it.
function LendTrackVisual() {
  const t = useTranslations("marketing.home.visual");
  const tHome = useTranslations("marketing.home");
  const rows: Array<{
    cover: string;
    title: string;
    sub: string;
    status: string;
    tone: MkBadgeTone;
  }> = [
    {
      cover: eendenvijver,
      title: "Eendenvijver",
      sub: t("onYourShelf"),
      status: t("available"),
      tone: "success",
    },
    {
      cover: molen,
      title: "Molen",
      sub: t("withName", { name: "Marieke" }),
      status: t("lentOut"),
      tone: "secondary",
    },
    {
      cover: amsterdam,
      title: "Amsterdam",
      sub: t("notificationSent"),
      status: t("recalled"),
      tone: "warning",
    },
  ];
  return (
    <div className="bg-mk-card pb-4 text-mk-text-strong min-[860px]:ml-auto min-[860px]:pb-6">
      <div className="flex items-baseline justify-between gap-3 px-4 pt-4 pb-1 min-[760px]:px-10 min-[860px]:pt-6">
        <span className="font-mk-heading text-[22px] leading-tight whitespace-nowrap min-[860px]:text-[28px]">
          {t("myPuzzles")}
        </span>
        <span className="text-[16px] text-mk-text-muted">
          {tHome("exampleShelf")}
        </span>
      </div>
      <ul className="flex flex-col">
        {rows.map((r) => (
          <li key={r.title} className="pt-3 min-[860px]:pt-4">
            <div className="flex items-end gap-3 px-4 min-[760px]:px-10 min-[860px]:gap-6">
              <img
                src={r.cover}
                alt=""
                width={480}
                height={372}
                loading="lazy"
                decoding="async"
                className="h-auto w-[72px] shrink-0 rounded-t-[2px] min-[860px]:w-[clamp(96px,20svh,200px)]"
              />
              <div className="min-w-0 flex-1 self-center">
                <div className="truncate text-[16px] font-bold min-[860px]:text-[20px]">
                  {r.title}
                </div>
                <div className="text-[16px] text-mk-text-muted min-[860px]:text-[18px]">
                  {r.sub}
                </div>
              </div>
              <MkBadge
                tone={r.tone}
                className="shrink-0 self-center text-[14px] min-[860px]:text-[16px]"
              >
                {r.status}
              </MkBadge>
            </div>
            <div className="h-[9px] bg-mk-plank" />
          </li>
        ))}
      </ul>
    </div>
  );
}
