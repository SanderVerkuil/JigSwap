import { Link } from "@/compat/link";
import { EDGE, TEXT_LINK } from "@/components/marketing/home/classes";
import { Reveal } from "@/components/marketing/reveal";
import { cn } from "@/lib/utils";
import { useTranslations } from "use-intl";

// The lending slip: how a box moves. What happens on the left, who does it on the right, joined by a
// leader of round dots, closing on the result.
export function HowPreview() {
  const t = useTranslations("marketing.home.how");
  const you = t("whoYou");
  const groups = [
    {
      title: t("fillTitle"),
      rows: [
        [t("fillRow1"), you],
        [t("fillRow2"), you],
      ],
    },
    {
      title: t("findTitle"),
      rows: [
        [t("findRow1"), you],
        [t("findRow2"), you],
        [t("findRow3"), you],
      ],
    },
    {
      title: t("handTitle"),
      rows: [
        [t("handRow1"), t("whoOwner")],
        [t("handRow2"), "JigSwap"],
      ],
    },
  ];

  return (
    <section className="bg-mk-canal text-mk-on-canal">
      <div
        className={cn(
          EDGE,
          "flex flex-col gap-10 py-[clamp(56px,8vw,120px)] min-[860px]:flex-row min-[860px]:items-start min-[860px]:justify-between min-[860px]:gap-12",
        )}
      >
        <div>
          <Reveal rise={20}>
            <h2 className="font-mk-heading text-[clamp(40px,4.4vw,68px)] leading-[1.05] font-normal text-balance">
              {t("title")}
            </h2>
          </Reveal>
          <Reveal rise={20} delay={70}>
            <p className="mt-5 max-w-[30ch] text-[18px] leading-[1.5] text-pretty">
              {t("lead")}
            </p>
          </Reveal>
          <Reveal rise={20} delay={140}>
            <Link
              href="/how-it-works"
              className={cn(
                TEXT_LINK,
                "mt-5 inline-flex min-h-11 items-center text-[18px]",
              )}
            >
              {t("link")}
            </Link>
          </Reveal>
        </div>

        <Reveal
          rise={32}
          delay={90}
          className="w-full shrink-0 min-[860px]:w-[420px] min-[1180px]:w-[480px]"
        >
          <div className="bg-mk-card px-5 py-7 text-[16px] leading-[1.4] text-mk-text-strong tabular-nums min-[760px]:px-7">
            {groups.map((group) => (
              <div key={group.title} className="mt-7 first:mt-0">
                <h3 className="text-[17px] leading-snug font-bold">
                  {group.title}
                </h3>
                <ul className="mt-2.5 flex flex-col gap-2">
                  {group.rows.map(([what, who]) => (
                    <li key={what} className="flex items-end gap-2">
                      <span className="min-w-0">{what}</span>
                      <span
                        aria-hidden="true"
                        className="mb-[5px] min-w-5 flex-1 border-b-[3px] border-dotted border-mk-text-muted/60"
                      />
                      <span className="shrink-0 whitespace-nowrap">{who}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <p className="mt-7 flex min-h-11 items-center bg-mk-canal px-3.5 py-2.5 leading-snug font-bold text-mk-on-canal">
              {t("result")}
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
