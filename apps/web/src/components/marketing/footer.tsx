import { Link } from "@/compat/link";
import { Container } from "@/components/marketing/container";
import { Wordmark } from "@/components/marketing/wordmark";
import { useTranslations } from "use-intl";

type FooterLink = { href: string; label: string };

// Four-column marketing footer: brand blurb + Product / Community / Legal.
export function MarketingFooter() {
  const t = useTranslations("marketing");

  const col = (title: string, links: FooterLink[]) => (
    <div className="flex flex-col gap-3">
      <div className="font-mk-heading font-semibold text-sm text-mk-text-strong">
        {title}
      </div>
      {links.map((lk) => (
        <Link
          key={lk.href + lk.label}
          href={lk.href}
          className="text-[14.5px] text-mk-text-muted hover:text-mk-violet-600 transition-colors"
        >
          {lk.label}
        </Link>
      ))}
    </div>
  );

  return (
    <footer className="border-t border-mk-border bg-mk-card pt-16 pb-9">
      <Container>
        <div className="grid grid-cols-[1.6fr_1fr_1fr_1fr] gap-10 max-[860px]:grid-cols-2 max-[860px]:gap-8 max-[540px]:grid-cols-1">
          <div className="max-w-[300px]">
            <Wordmark />
            <p className="mt-4 text-[14.5px] leading-relaxed text-mk-text-muted">
              {t("footer.tagline")}
            </p>
          </div>
          {col(t("footer.product"), [
            { href: "/how-it-works", label: t("nav.howItWorks") },
            { href: "/features", label: t("nav.features") },
            { href: "/sign-up", label: t("nav.startTrading") },
          ])}
          {col(t("footer.community"), [
            { href: "/about", label: t("nav.about") },
            { href: "/contact", label: t("nav.contact") },
            { href: "/about", label: t("footer.sustainability") },
          ])}
          {col(t("footer.legal"), [
            { href: "/privacy", label: t("footer.privacy") },
            { href: "/terms", label: t("footer.terms") },
            { href: "/privacy", label: t("footer.cookies") },
          ])}
        </div>
        <div className="mt-12 pt-6 border-t border-mk-border flex justify-between items-center flex-wrap gap-3">
          <span className="text-[13.5px] text-mk-text-muted">
            © {new Date().getFullYear()} JigSwap. {t("footer.madeBy")}
          </span>
          <span className="text-[13.5px] text-mk-text-muted">
            {t("footer.country")}
          </span>
        </div>
      </Container>
    </footer>
  );
}
