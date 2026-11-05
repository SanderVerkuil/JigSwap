import { Link } from "@/compat/link";
import coverAmsterdam from "@/components/marketing/assets/art/covers/amsterdam.webp";
import coverDorpsstraat from "@/components/marketing/assets/art/covers/dorpsstraat.webp";
import coverEendenvijver from "@/components/marketing/assets/art/covers/eendenvijver.webp";
import coverGrachtje from "@/components/marketing/assets/art/covers/grachtje.webp";
import coverMolen from "@/components/marketing/assets/art/covers/molen.webp";
import coverTheekoepel from "@/components/marketing/assets/art/covers/theekoepel.webp";
import coverTulpen from "@/components/marketing/assets/art/covers/tulpen.webp";
import houseCut from "@/components/marketing/assets/art/house-cut.webp";
import { ENTER, TEXT_LINK } from "@/components/marketing/home/classes";
import { useStartLink } from "@/components/marketing/use-start-link";
import { Button } from "@/components/ui/button";
import { globalStatsQuery, hasSocialProof } from "@/lib/marketing-queries";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import * as React from "react";
import { useFormatter, useTranslations } from "use-intl";

// Sample shelves for the demonstration in the hero. Names and titles are constants, not translated.
const PUZZLES = {
  dorpsstraat: { title: "Dorpsstraat", pieces: 1000, cover: coverDorpsstraat },
  eendenvijver: {
    title: "Eendenvijver",
    pieces: 1000,
    cover: coverEendenvijver,
  },
  theekoepel: { title: "Theekoepel", pieces: 2000, cover: coverTheekoepel },
  grachtje: { title: "Grachtje", pieces: 500, cover: coverGrachtje },
  tulpen: { title: "Tulpen", pieces: 1000, cover: coverTulpen },
  molen: { title: "Molen", pieces: 2000, cover: coverMolen },
  amsterdam: { title: "Amsterdam", pieces: 1000, cover: coverAmsterdam },
} as const;

// A box's width in the shelf's cover column follows its piece count, so the row reads as real boxes.
const BOX_WIDTH = { 500: "w-[68%]", 1000: "w-[85%]", 2000: "w-full" } as const;

// Everything on the art is measured in these units, which have the shape of house-cut.webp (2400x1578).
const ART_W = 2000;
const ART_H = 1315;
// The rooms run between the house's walls.
const ROOMS_LEFT = 550;
const ROOMS_RIGHT = 1443;

// Each person lives on a floor of the house and is who the art shows there. `top` and `bottom` bound the
// floor, which is the whole button; floors meet mid-beam, so no click falls between them. `pin` places the
// name on the art, high in the floor so the lowest clears the fold on a short laptop; `phonePin` keeps
// the larger-looking name wholly on its floor and clear of the wall at phone scale.
const PEOPLE = [
  {
    id: "sanne",
    name: "Sanne",
    top: 290,
    bottom: 552,
    boxes: ["theekoepel", "tulpen", "eendenvijver", "grachtje"],
    pin: { x: 720, y: 358 },
    phonePin: { x: 648, y: 430 },
  },
  {
    id: "opa",
    name: "Opa Wim",
    top: 552,
    bottom: 840,
    boxes: ["dorpsstraat", "molen", "grachtje"],
    pin: { x: 640, y: 640 },
    phonePin: { x: 677, y: 698 },
  },
  {
    id: "marieke",
    name: "Marieke",
    top: 840,
    bottom: 1100,
    boxes: ["amsterdam", "tulpen"],
    pin: { x: 680, y: 860 },
    phonePin: { x: 669, y: 985 },
  },
] as const satisfies ReadonlyArray<{
  id: string;
  name: string;
  top: number;
  bottom: number;
  boxes: ReadonlyArray<keyof typeof PUZZLES>;
  pin: { x: number; y: number };
  phonePin: { x: number; y: number };
}>;

type Person = (typeof PEOPLE)[number];
const DEFAULT_PERSON: Person = PEOPLE[1];

const percent = (part: number, whole: number) => `${(part / whole) * 100}%`;

// A floor's box on the art, and its name's place within that box.
function floorStyle({ top, bottom, pin, phonePin }: Person) {
  const width = ROOMS_RIGHT - ROOMS_LEFT;
  const height = bottom - top;
  return {
    left: percent(ROOMS_LEFT, ART_W),
    width: percent(width, ART_W),
    top: percent(top, ART_H),
    height: percent(height, ART_H),
    "--pin-x": percent(pin.x - ROOMS_LEFT, width),
    "--pin-y": percent(pin.y - top, height),
    "--phone-pin-x": percent(phonePin.x - ROOMS_LEFT, width),
    "--phone-pin-y": percent(phonePin.y - top, height),
  } as React.CSSProperties;
}

// The even-odd polygon that dims everything but the floors, each of which carries its own dim.
const AROUND_FLOORS = (() => {
  const [l, r] = [percent(ROOMS_LEFT, ART_W), percent(ROOMS_RIGHT, ART_W)];
  const t = percent(PEOPLE[0].top, ART_H);
  const b = percent(PEOPLE[PEOPLE.length - 1].bottom, ART_H);
  return `polygon(evenodd,0 0,100% 0,100% 100%,0 100%,0 0,${l} ${t},${r} ${t},${r} ${b},${l} ${b},${l} ${t})`;
})();

function TrustLine() {
  const t = useTranslations("marketing.home");
  // Prefetched in the home route loader, so the count is present on first paint.
  const { data: stats } = useQuery(globalStatsQuery);
  if (stats == null) return null;
  return (
    <p className="basis-full text-[17px] leading-snug min-[760px]:basis-auto min-[760px]:whitespace-nowrap">
      {hasSocialProof(stats)
        ? t("trustRow", { count: stats.totalUsers })
        : t("trustRowEarly")}
    </p>
  );
}

function ShelfRow({
  person,
  puzzleKey,
  askHref,
}: {
  person: Person;
  puzzleKey: keyof typeof PUZZLES;
  askHref: string;
}) {
  const t = useTranslations("marketing.home");
  const format = useFormatter();
  const puzzle = PUZZLES[puzzleKey];
  return (
    <li className="grid grid-cols-[minmax(0,min(42%,136px))_minmax(0,1fr)] items-end gap-x-3.5 pt-3">
      <img
        src={puzzle.cover}
        alt=""
        width={480}
        height={360}
        loading="lazy"
        decoding="async"
        className={cn(
          "block h-auto self-end rounded-t-[2px] border-b-[6px] border-mk-canal",
          BOX_WIDTH[puzzle.pieces],
        )}
      />
      <div className="flex min-w-0 flex-col items-start pb-2.5">
        <b className="text-[18px] leading-[1.2] font-bold">{puzzle.title}</b>
        <span className="text-[17px] leading-[1.25]">
          {t("pieces", { count: format.number(puzzle.pieces) })}
        </span>
        <Button
          variant="brand"
          asChild
          className="mt-1.5 h-[42px] rounded-[9px] px-3 text-[17px] font-bold min-[1180px]:px-2.5 min-[1180px]:text-[16px] min-[1360px]:px-3 min-[1360px]:text-[17px]"
        >
          <Link
            href={askHref}
            aria-label={t("askToBorrowLabel", {
              title: puzzle.title,
              name: person.name,
            })}
          >
            {t("askToBorrow")}
          </Link>
        </Button>
      </div>
      <div className="col-span-full -mx-(--ledge) h-[9px] bg-mk-plank" />
    </li>
  );
}

// The street with the fronts off: the sky's text, then the cutaway house edge to edge, with a pin on
// each of three floors. Choosing a floor strikes it forward and docks that person's shelf.
// Phone: title, the house alone (a window on the art from x 495 to 1495 and y 0 to 1104), sentence,
// actions, shelf.
export function Hero() {
  const t = useTranslations("marketing");
  const start = useStartLink();
  const [person, setPerson] = React.useState<Person>(DEFAULT_PERSON);

  const artRef = React.useRef<HTMLImageElement>(null);
  const drawerRef = React.useRef<HTMLElement>(null);

  // On a phone the shelf starts below the fold, so choosing a floor scrolls just far enough to show its
  // first box, which keeps the house and its other floors in view.
  const choose = (next: Person) => {
    setPerson(next);
    if (!window.matchMedia("(max-width: 759px)").matches) return;
    const firstBox = drawerRef.current?.querySelector("img");
    if (!firstBox) return;
    const overshoot =
      firstBox.getBoundingClientRect().bottom + 16 - window.innerHeight;
    if (overshoot <= 0) return;
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    window.scrollBy({
      top: overshoot,
      behavior: reduced ? "auto" : "smooth",
    });
  };

  // The drawer's notch points at the chosen floor while the sticky drawer rides over the art.
  React.useEffect(() => {
    const place = () => {
      const art = artRef.current?.getBoundingClientRect();
      const drawer = drawerRef.current;
      if (!art || !drawer) return;
      const box = drawer.getBoundingClientRect();
      const floorMiddle = (person.top + person.bottom) / 2;
      const y = art.top + floorMiddle * (art.width / ART_W) - box.top - 18;
      const notch = Math.max(12, Math.min(box.height - 48, y));
      drawer.style.setProperty("--notch", `${notch}px`);
    };
    place();
    window.addEventListener("scroll", place, { passive: true });
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place);
      window.removeEventListener("resize", place);
    };
  }, [person]);

  return (
    // --hero-pull is how far the art rises into the text row: the height of the neighbours' tops, which
    // stops them reaching the text. Short laptops pull further and cap the title lower, to keep all three
    // names on the first screen.
    <section className="@container relative flex flex-col bg-mk-sky text-mk-text-strong [--hero-h1-cap:15svh] [--hero-pull:calc(100cqw/2000*54)] [--m:16px] min-[760px]:block min-[760px]:[--m:40px] [@media(max-height:800px)]:[--hero-h1-cap:13svh] [@media(max-height:800px)]:[--hero-pull:calc(100cqw/2000*69)]">
      <div className="contents min-[760px]:relative min-[760px]:z-[3] min-[760px]:grid min-[760px]:grid-cols-1 min-[760px]:px-(--m) min-[1180px]:grid-cols-[minmax(0,1fr)_auto] min-[1180px]:items-start min-[1180px]:gap-x-6">
        <h1 className="order-1 mt-0.5 mb-2.5 px-(--m) font-mk-heading text-[length:calc((100cqw-2*var(--m))/7.25)] leading-[1.04] font-normal tracking-[-0.012em] min-[760px]:col-span-full min-[760px]:mt-[-2px] min-[760px]:mb-0 min-[760px]:px-0 min-[760px]:text-[length:min(calc((100cqw-2*var(--m))/10.2),var(--hero-h1-cap))] min-[760px]:leading-none min-[760px]:whitespace-nowrap">
          {t("home.heroTitle")}
        </h1>
        <p
          className={cn(
            "order-4 mt-3 px-(--m) text-[18px] leading-[1.36] text-pretty min-[760px]:mt-1.5 min-[760px]:max-w-[640px] min-[760px]:px-0 min-[760px]:text-[20px] min-[1180px]:[@media(max-height:880px)]:max-w-[560px] min-[1180px]:[@media(max-height:880px)]:text-[18px]",
            ENTER,
            "motion-safe:delay-[60ms]",
          )}
        >
          {t("home.heroLead")}
        </p>
        <div
          data-hero-action=""
          className={cn(
            "order-5 mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 px-(--m) min-[760px]:mt-2 min-[760px]:flex-nowrap min-[760px]:gap-x-[22px] min-[760px]:px-0 min-[1180px]:mt-1.5",
            ENTER,
            "motion-safe:delay-[130ms]",
          )}
        >
          <Button
            variant="brand"
            asChild
            className="h-[52px] rounded-[10px] px-[22px] text-[18px] font-bold min-[760px]:h-[50px] min-[760px]:text-[20px]"
          >
            <Link href={start.href}>{start.label}</Link>
          </Button>
          <Link
            href="/catalog"
            className={cn(
              TEXT_LINK,
              "inline-flex min-h-11 items-center text-[18px] whitespace-nowrap",
            )}
          >
            {t("nav.catalog")}
          </Link>
          <TrustLine />
        </div>
      </div>

      <div className="contents min-[760px]:relative min-[760px]:block min-[1180px]:-mt-(--hero-pull)">
        <div className="relative order-2 h-[calc(100cqw/1000*1104)] overflow-hidden min-[760px]:h-auto min-[760px]:overflow-visible">
          <div className="absolute top-0 left-[calc(100cqw/1000*-495)] w-[calc(100cqw/1000*2000)] min-[760px]:relative min-[760px]:top-0 min-[760px]:left-0 min-[760px]:w-full">
            <img
              ref={artRef}
              src={houseCut}
              alt={t("home.heroAlt")}
              width={2400}
              height={1578}
              fetchPriority="high"
              decoding="async"
              className="block h-auto w-full max-w-none"
            />
            {/* Flat dim over the art, masked to the art's own edge so the sky stays clean. */}
            <div
              aria-hidden="true"
              className="absolute inset-0 bg-mk-canal/45"
              style={{
                maskImage: `url("${houseCut}")`,
                WebkitMaskImage: `url("${houseCut}")`,
                maskSize: "100% 100%",
                WebkitMaskSize: "100% 100%",
                clipPath: AROUND_FLOORS,
              }}
            />

            <div
              role="group"
              aria-label={t("home.pickerLabel")}
              className="pointer-events-none absolute inset-0"
            >
              {PEOPLE.map((p) => {
                const active = p.id === person.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => choose(p)}
                    style={floorStyle(p)}
                    className="group pointer-events-auto absolute cursor-pointer outline-none [-webkit-tap-highlight-color:transparent]"
                  >
                    {/* The floor's dim lifts when it is chosen, and partly while it is pointed at. */}
                    <span
                      aria-hidden="true"
                      className={cn(
                        "absolute inset-0 bg-mk-canal/45 transition-opacity duration-[180ms] ease-mk-out",
                        active
                          ? "opacity-0"
                          : "group-hover:opacity-50 group-focus-visible:opacity-50",
                      )}
                    />
                    <span
                      className={cn(
                        "absolute top-(--phone-pin-y) left-(--phone-pin-x) inline-flex min-h-11 -translate-x-1/2 -translate-y-full items-center justify-center rounded-[10px] px-3 text-[16px] font-bold whitespace-nowrap after:absolute after:-bottom-[9px] after:left-1/2 after:-ml-[9px] after:block after:h-2.5 after:w-[18px] after:bg-inherit after:[clip-path:polygon(0_0,100%_0,50%_100%)] after:content-[''] min-[760px]:top-(--pin-y) min-[760px]:left-(--pin-x) min-[760px]:min-h-[46px] min-[760px]:px-[18px] min-[760px]:text-[18px] min-[760px]:after:-bottom-[11px] min-[760px]:after:-ml-[11px] min-[760px]:after:h-3 min-[760px]:after:w-[22px]",
                        "transition-transform duration-[160ms] ease-mk-out motion-safe:group-active:scale-[0.97]",
                        "group-focus-visible:outline-3 group-focus-visible:outline-offset-0 group-focus-visible:outline-mk-on-canal group-focus-visible:ring-[7px] group-focus-visible:ring-mk-canal",
                        active
                          ? "bg-mk-gold text-mk-on-gold group-hover:bg-mk-gold-press"
                          : "bg-mk-canal text-mk-on-canal group-hover:bg-[color-mix(in_oklab,var(--mk-canal)_86%,var(--mk-on-canal))] dark:bg-mk-card",
                      )}
                    >
                      {p.name}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="contents min-[1180px]:pointer-events-none min-[1180px]:absolute min-[1180px]:top-(--hero-pull) min-[1180px]:right-0 min-[1180px]:bottom-0 min-[1180px]:flex min-[1180px]:w-[25.8%] min-[1180px]:flex-col">
          <aside
            ref={drawerRef}
            aria-labelledby="hero-shelf-title"
            className="relative order-7 mt-3 bg-mk-card px-(--m) pt-4 pb-2 [--ledge:var(--m)] min-[760px]:mt-0 min-[760px]:pt-[22px] min-[760px]:pb-4 min-[760px]:[--ledge:0px] min-[1180px]:pointer-events-auto min-[1180px]:sticky min-[1180px]:bottom-0 min-[1180px]:z-[4] min-[1180px]:mt-auto min-[1180px]:px-5 min-[1180px]:[--ledge:calc(var(--spacing)*5)] min-[1180px]:before:absolute min-[1180px]:before:top-(--notch,40px) min-[1180px]:before:-left-4 min-[1180px]:before:h-9 min-[1180px]:before:w-[17px] min-[1180px]:before:bg-inherit min-[1180px]:before:[clip-path:polygon(100%_0,100%_100%,0_50%)] min-[1180px]:before:content-[''] min-[1360px]:px-6 min-[1360px]:[--ledge:calc(var(--spacing)*6)]"
          >
            <h2
              id="hero-shelf-title"
              aria-live="polite"
              className="font-mk-heading text-[28px] leading-[1.1] font-normal text-balance min-[760px]:text-[32px] min-[1180px]:text-[26px] min-[1360px]:text-[30px]"
            >
              {t("home.shelfOf", { name: person.name })}
            </h2>
            <p className="mt-0.5 text-[17px]">{t("home.exampleShelf")}</p>
            <ul className="mt-3.5 min-[760px]:max-[1179px]:grid min-[760px]:max-[1179px]:grid-cols-2 min-[760px]:max-[1179px]:gap-x-7 min-[1000px]:max-[1179px]:grid-cols-3">
              {person.boxes.map((key) => (
                <ShelfRow
                  key={key}
                  person={person}
                  puzzleKey={key}
                  askHref={start.href}
                />
              ))}
            </ul>
          </aside>
        </div>
      </div>
    </section>
  );
}
