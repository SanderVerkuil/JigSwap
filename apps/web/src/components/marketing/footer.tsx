import { Link } from "@/compat/link";
import { StreetSkyline } from "@/components/common/street-skyline";
import { FOCUS, PRESS } from "@/components/marketing/home/classes";
import { cn } from "@/lib/utils";
import * as React from "react";
import { useTranslations } from "use-intl";

type FooterLink = { href: string; label: string };

// A curtain footer is pinned behind the page; a keyboard user who tabs into it would land on links the
// page still covers, and the browser sees no reason to scroll to something already "in view". Clicks
// are left alone, so the page does not jump under a pointer.
function uncoverOnKeyboardFocus(event: React.FocusEvent<HTMLElement>) {
  if (
    event.target.matches(":focus-visible") &&
    getComputedStyle(event.currentTarget).position === "sticky"
  ) {
    window.scrollTo(0, document.documentElement.scrollHeight);
  }
}

// The back of the street: a board of filled tiles. With `curtain`, the opaque page in front (z-10)
// slides up to uncover it, by sticky positioning alone. That is switched off wherever the board is
// taller than the viewport below the header, because a sticky footer that tall would leave its top
// tiles unreachable.
export function MarketingFooter({ curtain = false }: { curtain?: boolean }) {
  const t = useTranslations("marketing");

  const tile = (title: string, links: FooterLink[], className: string) => (
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
            <Link
              href={lk.href}
              className={cn(
                PRESS,
                FOCUS,
                "inline-flex min-h-9 origin-left items-center text-[16px] hover:underline hover:decoration-2 hover:underline-offset-4",
              )}
            >
              {lk.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );

  return (
    <footer
      onFocusCapture={curtain ? uncoverOnKeyboardFocus : undefined}
      className={cn(
        "bg-mk-bg text-mk-text-strong",
        curtain &&
          "z-0 min-[640px]:[@media(min-height:1120px)]:sticky min-[640px]:[@media(min-height:1120px)]:bottom-0 min-[1024px]:[@media(min-height:700px)]:sticky min-[1024px]:[@media(min-height:700px)]:bottom-0",
      )}
    >
      <div className="grid grid-cols-2 gap-1.5 p-2 min-[1024px]:grid-cols-12 min-[1024px]:gap-2 min-[1024px]:p-3">
        {tile(
          t("footer.product"),
          [
            { href: "/how-it-works", label: t("nav.howItWorks") },
            { href: "/catalog", label: t("nav.catalog") },
            { href: "/features", label: t("nav.features") },
            { href: "/docs", label: t("nav.docs") },
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
            { href: "/privacy", label: t("footer.cookies") },
          ],
          "col-span-2 bg-mk-plank min-[1024px]:col-span-3 min-[1024px]:col-start-10 min-[1024px]:row-start-1",
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

        {/* The loud moment: the name at the full width of the street, knocked out in one light colour
            because the two-tone logo turns garish at this size on ink. Capped by height so the board
            still fits a short laptop and the curtain keeps working. */}
        <div className="@container relative col-span-2 min-h-[180px] overflow-hidden bg-mk-canal [--skyline-window:var(--mk-gold)] min-[1024px]:col-span-12">
          <span
            aria-hidden="true"
            className="font-logo relative z-[1] block pt-[1.6cqw] pb-[3cqw] text-center text-[length:min(26cqw,max(72px,calc((100svh-336px-4.6cqw)/0.92)))] leading-[0.92] font-bold text-[#b4dcf8] dark:text-mk-on-canal"
          >
            JigSwap
          </span>
          <div
            aria-hidden="true"
            className="absolute inset-x-0 bottom-0 flex text-[color-mix(in_oklab,var(--mk-canal)_84%,var(--mk-on-canal))]"
          >
            <StreetSkyline className="h-[120px] w-[480px] shrink-0" />
            <StreetSkyline className="h-[120px] w-[480px] shrink-0 -scale-x-100" />
            <StreetSkyline className="h-[120px] w-[480px] shrink-0" />
            <StreetSkyline className="h-[120px] w-[480px] shrink-0 -scale-x-100" />
            <StreetSkyline className="h-[120px] w-[480px] shrink-0" />
          </div>
        </div>
      </div>
    </footer>
  );
}
