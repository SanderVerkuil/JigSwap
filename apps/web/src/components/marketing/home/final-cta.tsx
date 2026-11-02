import { Link } from "@/compat/link";
import canalBoat from "@/components/marketing/assets/art/crops/canal-boat.webp";
import picnic from "@/components/marketing/assets/art/crops/picnic.webp";
import handover from "@/components/marketing/assets/art/crops/window-handover.webp";
import { EDGE } from "@/components/marketing/home/classes";
import { Reveal } from "@/components/marketing/reveal";
import { useStartHref } from "@/components/marketing/use-start-href";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTranslations } from "use-intl";

// Closing: three art crops with a gutter between them, then the sky band with the statement and the one
// marigold action directly under it, which stands out on sky more than it would on a marigold band.
export function FinalCTA() {
  const t = useTranslations("marketing");
  const startHref = useStartHref();
  const crops = [
    { src: handover, width: 560, alt: t("home.pictures.handover") },
    { src: picnic, width: 640, alt: t("home.pictures.picnic") },
    { src: canalBoat, width: 480, alt: t("home.pictures.boat") },
  ];
  return (
    <section>
      <div className="grid grid-cols-2 gap-1.5 bg-mk-sky min-[760px]:h-[40svh] min-[760px]:grid-cols-3">
        {crops.map((crop, i) => (
          <Reveal
            key={crop.src}
            rise={24}
            delay={i * 70}
            className={cn(
              "min-h-0",
              i === 0 && "col-span-2 min-[760px]:col-span-1",
            )}
          >
            <img
              src={crop.src}
              alt={crop.alt}
              width={crop.width}
              height={crop.width * 0.75}
              loading="lazy"
              decoding="async"
              className="block aspect-[4/3] h-auto w-full object-cover min-[760px]:aspect-auto min-[760px]:h-full"
            />
          </Reveal>
        ))}
      </div>
      <div className="bg-mk-sky text-mk-text-strong">
        <div className={cn(EDGE, "py-[clamp(40px,6vw,88px)]")}>
          <Reveal rise={20}>
            <h2 className="max-w-[16em] font-mk-heading text-[clamp(32px,4.4vw,68px)] leading-[1.06] font-normal text-balance">
              {t("home.cta.title")}
            </h2>
          </Reveal>
          <Reveal rise={20} delay={70}>
            <p className="mt-4 max-w-[46ch] text-[18px] leading-[1.5] text-pretty">
              {t("home.cta.body")}
            </p>
          </Reveal>
          <Reveal rise={20} delay={140} className="mt-7">
            <Button
              variant="brand"
              asChild
              className="h-[54px] rounded-[10px] px-6 text-[18px] font-bold"
            >
              <Link href={startHref}>{t("nav.startShelf")}</Link>
            </Button>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
