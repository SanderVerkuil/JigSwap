import { Link } from "@/compat/link";
import { Container } from "@/components/marketing/container";
import { useStartLink } from "@/components/marketing/use-start-link";
import { Wordmark } from "@/components/marketing/wordmark";
import { openCookieSettings } from "@/lib/analytics-consent";
import { Link as RouterLink } from "@tanstack/react-router";
import type * as React from "react";
import { useTranslations } from "use-intl";

type FooterLink = { href: string; label: string };

// On touch screens the links grow to 34px while the list's gap closes, so the rhythm stays.
const linkCls =
  "text-[14.5px] text-mk-text-muted hover:text-mk-violet-600 transition-colors pointer-coarse:py-1.5";

// Four-column marketing footer: brand blurb + Product / Community / Legal.
export function MarketingFooter() {
  const t = useTranslations("marketing");
  const start = useStartLink();

  const col = (title: string, links: FooterLink[], extra?: React.ReactNode) => (
    <div className="flex flex-col gap-3 pointer-coarse:gap-0">
      <div className="font-mk-heading font-semibold text-sm text-mk-text-strong pointer-coarse:mb-1.5">
        {title}
      </div>
      {links.map((lk) => (
        <Link key={lk.href + lk.label} href={lk.href} className={linkCls}>
          {lk.label}
        </Link>
      ))}
      {extra}
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
            { href: "/catalog", label: t("nav.catalog") },
            { href: "/features", label: t("nav.features") },
            { href: "/docs", label: t("nav.docs") },
            start,
          ])}
          {col(t("footer.community"), [
            { href: "/about", label: t("nav.about") },
            { href: "/contact", label: t("nav.contact") },
          ])}
          {col(
            t("footer.legal"),
            [
              { href: "/privacy", label: t("footer.privacy") },
              { href: "/terms", label: t("footer.terms") },
            ],
            <>
              <RouterLink to="/privacy" hash="p-cookies" className={linkCls}>
                {t("footer.cookies")}
              </RouterLink>
              {/* Reopens the cookie banner, so analytics consent can be
                  changed or withdrawn at any time (GDPR Art. 7(3)). */}
              <button
                type="button"
                onClick={openCookieSettings}
                className={`${linkCls} text-left cursor-pointer`}
              >
                {t("footer.cookieSettings")}
              </button>
            </>,
          )}
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
