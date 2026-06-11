import { Link } from "@/compat/link";
import { Container } from "@/components/marketing/container";
import { Reveal } from "@/components/marketing/reveal";
import { Section, SectionHead } from "@/components/marketing/section";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { useTranslations } from "use-intl";

// Three-step teaser for the dedicated how-it-works page.
export function HowPreview() {
  const t = useTranslations("marketing.home.how");
  const steps = [1, 2, 3] as const;
  return (
    <Section>
      <Container>
        <SectionHead
          align="center"
          eyebrow={t("eyebrow")}
          title={t("title")}
          lead={t("lead")}
        />
        <div className="grid grid-cols-3 max-[860px]:grid-cols-1 gap-[clamp(28px,4vw,48px)] mt-14">
          {steps.map((n, i) => (
            <Reveal key={n} delay={i * 100}>
              <div className="flex flex-col gap-3">
                <div className="flex items-baseline gap-3.5 pb-3.5 border-b-2 border-mk-violet-200">
                  <span className="font-mk-heading font-bold text-[40px] leading-none text-mk-violet-600">
                    {n}
                  </span>
                  <h3 className="font-mk-heading font-bold tracking-tight text-[21px] text-mk-text-strong">
                    {t(`step${n}Title`)}
                  </h3>
                </div>
                <p className="text-[15.5px] leading-relaxed text-mk-text-muted">
                  {t(`step${n}Body`)}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
        <div className="text-center mt-12">
          <Button
            variant="outline"
            className="bg-mk-card border-mk-border text-mk-text-strong hover:bg-mk-muted"
            asChild
          >
            <Link href="/how-it-works">
              {t("link")}
              <ArrowRight size={16} />
            </Link>
          </Button>
        </div>
      </Container>
    </Section>
  );
}
