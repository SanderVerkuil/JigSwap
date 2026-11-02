import { EDGE } from "@/components/marketing/home/classes";
import { Reveal } from "@/components/marketing/reveal";
import { globalStatsQuery } from "@/lib/marketing-queries";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "use-intl";

// The live figures in a sentence: real platform numbers from gateway.insights.globalStats, prefetched
// in the home route loader. Small numbers stay as they are.
export function Stats() {
  const t = useTranslations("marketing.home.stats");
  const { data: stats } = useQuery(globalStatsQuery);

  return (
    <section className="bg-mk-bg text-mk-text-strong">
      <div className={cn(EDGE, "py-[clamp(64px,9vw,136px)]")}>
        <h2 className="sr-only">{t("title")}</h2>
        <Reveal rise={24}>
          <p className="max-w-[34em] font-mk-heading text-[clamp(24px,2.5vw,36px)] leading-[1.3] text-pretty">
            {stats == null
              ? "–"
              : t("sentence", {
                  puzzlers: t("puzzlers", { count: stats.totalUsers }),
                  shelves: t("shelves", { count: stats.totalOwnedPuzzles }),
                  catalog: t("catalog", { count: stats.totalPuzzles }),
                })}
          </p>
        </Reveal>
      </div>
    </section>
  );
}
