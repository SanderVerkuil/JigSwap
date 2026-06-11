import { Container } from "@/components/marketing/container";
import { Reveal } from "@/components/marketing/reveal";
import { Section } from "@/components/marketing/section";
import { useTranslations } from "use-intl";

// Founders' quote — the prototype's invented user testimonial is replaced by
// an honest note from the family behind JigSwap.
export function Testimonial() {
  const t = useTranslations("marketing.home.quote");
  return (
    <Section>
      <Container narrow>
        <Reveal className="text-center">
          <div className="text-[40px] leading-none">🧩</div>
          <p className="font-mk-heading font-medium text-[clamp(22px,3vw,30px)] leading-[1.4] text-mk-text-strong mt-5">
            {t("text")}
          </p>
          <div className="mt-6 flex items-center justify-center gap-3">
            <span className="w-11 h-11 rounded-full bg-mk-violet-400 text-white inline-flex items-center justify-center text-lg">
              🧩
            </span>
            <div className="text-left">
              <div className="font-semibold text-mk-text-strong text-[15px]">
                {t("name")}
              </div>
              <div className="text-[13.5px] text-mk-text-muted">{t("sub")}</div>
            </div>
          </div>
        </Reveal>
      </Container>
    </Section>
  );
}
