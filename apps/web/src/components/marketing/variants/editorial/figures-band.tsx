import { Container } from "@/components/marketing/container";
import { Reveal } from "@/components/marketing/reveal";
import type { LandingData } from "@/components/marketing/variants/use-landing-data";
import { useFormatter } from "use-intl";

import { Figure } from "./figure";

// Big-number band: the three live platform numbers rendered as enormous
// editorial figures — credibility through scale, "the issue stats".
export function FiguresBand({ data }: { data: LandingData }) {
  const format = useFormatter();
  const { stats } = data;
  const loading = stats == null;

  const n = (v: number) => format.number(v);

  return (
    <section className="bg-mk-muted border-y border-mk-border py-[clamp(48px,7vw,88px)]">
      <Container>
        <Reveal>
          <div className="grid min-[861px]:grid-cols-3 divide-y min-[861px]:divide-y-0 min-[861px]:divide-x divide-mk-border text-center">
            <Figure
              loading={loading}
              value={stats ? n(stats.totalUsers) : "—"}
              caption="puzzlers"
              sentence={`${stats ? n(stats.totalUsers) : ""} puzzlers in the community`}
              className="py-7 min-[861px]:py-0"
            />
            <Figure
              loading={loading}
              value={stats ? n(stats.totalPuzzles) : "—"}
              caption="in circulation"
              sentence={`${stats ? n(stats.totalPuzzles) : ""} puzzles in circulation`}
              className="py-7 min-[861px]:py-0"
            />
            <Figure
              loading={loading}
              value={stats ? n(stats.totalOwnedPuzzles) : "—"}
              caption="on shelves"
              sentence={`${stats ? n(stats.totalOwnedPuzzles) : ""} puzzles on shelves`}
              className="py-7 min-[861px]:py-0"
            />
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
