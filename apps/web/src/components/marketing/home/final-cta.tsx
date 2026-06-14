import { Link } from "@/compat/link";
import { Container } from "@/components/marketing/container";
import { PieceMotif } from "@/components/marketing/piece-motif";
import { Section } from "@/components/marketing/section";
import { useStartHref } from "@/components/marketing/use-start-href";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { useTranslations } from "use-intl";

// Closing CTA panel: violet gradient, floating piece motifs, white button.
export function FinalCTA() {
  const t = useTranslations("marketing");
  const startHref = useStartHref();
  return (
    <Section>
      <Container>
        <div className="relative overflow-hidden rounded-[20px] [background:linear-gradient(135deg,var(--mk-violet-600),var(--mk-violet-400))] p-[clamp(44px,6vw,76px)] text-center">
          <PieceMotif
            size={140}
            color="rgba(255,255,255,.12)"
            rotate={-12}
            className="absolute -top-6 -left-2.5"
          />
          <PieceMotif
            size={110}
            color="rgba(255,255,255,.10)"
            rotate={18}
            className="absolute -bottom-[30px] right-5"
          />
          <div className="relative">
            <h2 className="font-mk-heading font-bold tracking-tight text-[clamp(28px,4vw,44px)] text-white leading-[1.1]">
              {t("home.cta.title")}
            </h2>
            <p className="text-lg text-white/90 mt-4 max-w-[520px] mx-auto">
              {t("home.cta.body")}
            </p>
            <div className="mt-[30px] flex justify-center">
              <Button
                className="h-11 px-6 text-[15px] bg-white text-mk-violet-600 hover:bg-white/90"
                asChild
              >
                <Link href={startHref}>
                  {t("nav.startTrading")}
                  <ArrowRight size={17} />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </Container>
    </Section>
  );
}
