import { Container } from "@/components/marketing/container";
import { Reveal } from "@/components/marketing/reveal";
import { Section } from "@/components/marketing/section";
import { gateway } from "@/gateway";
import { useQuery } from "convex/react";
import { useFormatter, useTranslations } from "use-intl";

// Stats strip — real platform numbers from gateway.insights.globalStats
// (the prototype's invented totals would overclaim).
export function Stats() {
  const t = useTranslations("marketing.home.stats");
  const format = useFormatter();
  const stats = useQuery(gateway.insights.globalStats, {});

  const items: Array<[string, number | undefined]> = [
    [t("puzzlers"), stats?.totalUsers],
    [t("catalog"), stats?.totalPuzzles],
    [t("shelves"), stats?.totalOwnedPuzzles],
  ];

  return (
    <Section tint className="py-11">
      <Container>
        <div className="grid grid-cols-3 max-[860px]:grid-cols-1 gap-6 max-[860px]:gap-7">
          {items.map(([label, value], i) => (
            <Reveal key={label} delay={i * 70} className="text-center">
              <div className="font-mk-heading font-bold text-[clamp(30px,4vw,42px)] text-mk-violet-600 leading-none">
                {value != null ? format.number(value) : "—"}
              </div>
              <div className="text-sm text-mk-text-muted mt-2">{label}</div>
            </Reveal>
          ))}
        </div>
      </Container>
    </Section>
  );
}
