import { Link } from "@/compat/link";
import { StreetSkyline } from "@/components/common/street-skyline";
import { FOCUS, PRESS } from "@/components/marketing/home/classes";
import { useStartLink } from "@/components/marketing/use-start-link";
import { openCookieSettings } from "@/lib/analytics-consent";
import { cn } from "@/lib/utils";
import { Link as RouterLink } from "@tanstack/react-router";
import * as React from "react";
import { useTranslations } from "use-intl";

type FooterLink = { href: string; label: string };

const LINK = cn(
  PRESS,
  FOCUS,
  "inline-flex min-h-9 origin-left items-center text-[16px] hover:underline hover:decoration-2 hover:underline-offset-4",
);

// The back of the street: a board of filled tiles, then the name over the street. With `curtain`, only
// the name is pinned: the board arrives with the page like any other content, so its links come first,
// and then slides up to uncover the street, by sticky positioning alone. The street is confined to the
// footer and is always shorter than the viewport, so nothing it hides can become unreachable.
export function MarketingFooter({ curtain = false }: { curtain?: boolean }) {
  const t = useTranslations("marketing");
  const start = useStartLink();

  const tile = (
    title: string,
    links: FooterLink[],
    className: string,
    extra?: React.ReactNode,
  ) => (
    <nav
      aria-label={title}
      className={cn(
        "flex min-h-[200px] flex-col p-5 min-[1024px]:min-h-[240px] min-[1280px]:p-6",
        className,
      )}
    >
      <h2 className="font-mk-heading text-[20px] leading-tight font-normal min-[1024px]:text-[19px] min-[1280px]:text-[22px]">
        {title}
      </h2>
      <ul className="mt-3 flex flex-col">
        {links.map((lk) => (
          <li key={lk.href + lk.label}>
            {/* Current on its own page only: Docs isn't the page on every docs article. */}
            <Link
              href={lk.href}
              activeOptions={{ exact: true }}
              className={LINK}
            >
              {lk.label}
            </Link>
          </li>
        ))}
        {extra}
      </ul>
    </nav>
  );

  return (
    <footer
      className={cn("bg-mk-bg text-mk-text-strong", curtain && "isolate")}
    >
      <div className="relative z-[1] grid grid-cols-2 gap-1.5 bg-mk-bg p-2 pb-1.5 min-[1024px]:grid-cols-12 min-[1024px]:gap-2 min-[1024px]:p-3 min-[1024px]:pb-2">
        {tile(
          t("footer.product"),
          [
            { href: "/how-it-works", label: t("nav.howItWorks") },
            { href: "/catalog", label: t("nav.catalog") },
            { href: "/features", label: t("nav.features") },
            { href: "/docs", label: t("nav.docs") },
            start,
          ],
          "bg-mk-sky-soft dark:bg-mk-muted min-[1024px]:col-span-3 min-[1024px]:col-start-5 min-[1024px]:row-start-1",
        )}
        {tile(
          t("footer.community"),
          [
            { href: "/about", label: t("nav.about") },
            { href: "/contact", label: t("nav.contact") },
          ],
          "bg-mk-sky-soft dark:bg-mk-muted min-[1024px]:col-span-2 min-[1024px]:col-start-8 min-[1024px]:row-start-1",
        )}
        {tile(
          t("footer.legal"),
          [
            { href: "/privacy", label: t("footer.privacy") },
            { href: "/terms", label: t("footer.terms") },
          ],
          "col-span-2 bg-mk-plank min-[1024px]:col-span-3 min-[1024px]:col-start-10 min-[1024px]:row-start-1",
          <>
            <li>
              {/* Current only at the cookie section, not anywhere on the privacy policy. */}
              <RouterLink
                to="/privacy"
                hash="p-cookies"
                activeOptions={{ exact: true, includeHash: true }}
                className={LINK}
              >
                {t("footer.cookies")}
              </RouterLink>
            </li>
            {/* Reopens the cookie banner, so analytics consent can be changed or withdrawn at any
                time (GDPR Art. 7(3)). */}
            <li>
              <button
                type="button"
                onClick={openCookieSettings}
                className={cn(LINK, "cursor-pointer text-left")}
              >
                {t("footer.cookieSettings")}
              </button>
            </li>
          </>,
        )}

        <div className="col-span-2 flex min-h-[200px] flex-col justify-between gap-6 bg-mk-sky p-5 min-[1024px]:col-span-4 min-[1024px]:col-start-1 min-[1024px]:row-start-1 min-[1024px]:min-h-[240px] min-[1024px]:p-6">
          <p className="font-mk-heading text-[22px] leading-[1.25] text-pretty min-[1024px]:text-[24px]">
            {t("footer.tagline")}
          </p>
          <p className="text-[14px] leading-snug">
            © {new Date().getFullYear()} JigSwap. {t("footer.madeBy")}{" "}
            {t("footer.country")}
          </p>
        </div>
      </div>

      {/* The loud moment: the name at the full width of the street, knocked out in one light colour
          because the two-tone logo turns garish at this size on ink. Capped by height so the links and
          the name still fit one screen on a short laptop. */}
      <div
        className={cn(
          "px-2 pb-2 min-[1024px]:px-3 min-[1024px]:pb-3",
          curtain && "sticky bottom-0",
        )}
      >
        <div className="@container relative min-h-[180px] overflow-hidden bg-mk-canal [--skyline-window:var(--mk-gold)]">
          <span
            aria-hidden="true"
            className="font-logo relative z-[1] block pt-[1.6cqw] pb-[3cqw] text-center text-[length:min(26cqw,max(72px,calc((100svh-336px-4.6cqw)/0.92)))] leading-[0.92] font-bold text-[#b4dcf8] dark:text-mk-on-canal"
          >
            JigSwap
          </span>
          {/* Five stretches of street, at their drawn size up to 2400px and growing with the band beyond
              that, so the street always reaches both edges. Each overlaps the next by a pixel, so no
              hairline opens where they meet at a fractional position. */}
          <div
            aria-hidden="true"
            className="absolute bottom-0 left-0 flex w-[max(100%,2400px)] items-end text-[color-mix(in_oklab,var(--mk-canal)_84%,var(--mk-on-canal))]"
          >
            <StreetSkyline className="-mr-px h-auto w-[calc(20%+1px)] shrink-0" />
            <StreetSkyline className="-mr-px h-auto w-[calc(20%+1px)] shrink-0 -scale-x-100" />
            <StreetSkyline className="-mr-px h-auto w-[calc(20%+1px)] shrink-0" />
            <StreetSkyline className="-mr-px h-auto w-[calc(20%+1px)] shrink-0 -scale-x-100" />
            <StreetSkyline className="-mr-px h-auto w-[calc(20%+1px)] shrink-0" />
          </div>
        </div>
      </div>
    </footer>
  );
}
