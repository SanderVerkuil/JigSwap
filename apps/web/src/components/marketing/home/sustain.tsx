import { Container } from "@/components/marketing/container";
import { PieceMotif } from "@/components/marketing/piece-motif";
import { Reveal } from "@/components/marketing/reveal";
import { Eyebrow, Section } from "@/components/marketing/section";
import { useTranslations } from "use-intl";

// Sustainability band: copy + a loose collage of puzzle-piece motifs.
export function Sustain() {
  const t = useTranslations("marketing.home.sustain");
  return (
    <Section tint>
      <Container>
        <div className="grid grid-cols-2 max-[860px]:grid-cols-1 gap-[clamp(32px,5vw,72px)] items-center">
          <Reveal>
            <Eyebrow>{t("eyebrow")}</Eyebrow>
            <h2 className="font-mk-heading font-bold tracking-tight text-[clamp(28px,4vw,40px)] mt-4 leading-[1.1] text-mk-text-strong">
              {t("title")}
            </h2>
            <p className="text-lg leading-relaxed text-mk-text-muted mt-4 max-w-[520px] text-pretty">
              {t("body")}
            </p>
          </Reveal>
          <Reveal delay={120} className="flex justify-center">
            <div className="relative w-[280px] h-[200px]" aria-hidden="true">
              <PieceMotif
                size={120}
                color="var(--mk-green-300)"
                rotate={-12}
                className="absolute top-2 left-6"
              />
              <PieceMotif
                size={92}
                color="var(--mk-violet-300)"
                rotate={18}
                className="absolute top-[70px] left-[120px]"
              />
              <PieceMotif
                size={70}
                color="var(--mk-pink-300)"
                rotate={-4}
                className="absolute top-6 left-[178px] opacity-85"
              />
            </div>
          </Reveal>
        </div>
      </Container>
    </Section>
  );
}
