import { Link } from "@/compat/link";
import { MAIN_CONTENT_ID } from "@/components/a11y/skip-link";
import { StreetSkyline } from "@/components/common/street-skyline";
import { LangToggle, ModeToggle } from "@/components/marketing/header";
import { FOCUS } from "@/components/marketing/home/classes";
import { Wordmark } from "@/components/marketing/wordmark";
import { openCookieSettings } from "@/lib/analytics-consent";
import type * as React from "react";
import { useTranslations } from "use-intl";

// FOCUS draws the ring in the link's own ink: the global ring is too dark to see on the canal band.
const footerLinkCls = `inline-flex min-h-10 items-center text-[14px] text-mk-on-canal underline-offset-4 hover:underline ${FOCUS}`;

// The field behind the Clerk sign-in / sign-up cards, on the street's flat sky: a slim bar with the
// wordmark (the way back home) and the language + theme switches, the card in
// the page's <main>, and a footer with the legal pages and the public
// catalogue. Deliberately lighter than the marketing header: no nav and no
// sign-up CTA competing with the form. The marketing font is set on the bar
// and footer only, so the Clerk card keeps the app font it shares with the
// in-app Clerk UI. On phones the card sits near the top, clear of the
// on-screen keyboard; from sm up it is centred. The row of gables stands on the footer's canal ground.
export function AuthShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations("marketing");
  return (
    <div className="mk-root bg-mk-sky! min-h-svh flex flex-col overflow-x-clip">
      <header className="font-mk-sans w-full px-4 min-[760px]:px-10 h-16 flex items-center gap-3">
        <Link href="/" aria-label="JigSwap">
          <Wordmark />
        </Link>
        <div className="ml-auto flex items-center gap-2.5">
          <LangToggle />
          <ModeToggle />
        </div>
      </header>
      <main
        id={MAIN_CONTENT_ID}
        className="flex-1 flex items-start sm:items-center justify-center px-4 py-4 sm:py-10"
      >
        <div className="w-full max-w-md">{children}</div>
      </main>
      <div
        aria-hidden="true"
        className="overflow-hidden text-mk-canal dark:[--skyline-window:var(--mk-gold)]"
      >
        <div className="flex w-[max(100%,1920px)] items-end">
          {[0, 1, 2, 3].map((i) => (
            <StreetSkyline
              key={i}
              className={`-mr-px h-auto w-[calc(25%+1px)] shrink-0${i % 2 === 1 ? " -scale-x-100" : ""}`}
            />
          ))}
        </div>
      </div>
      <footer className="font-mk-sans bg-mk-canal">
        <div className="w-full px-4 min-[760px]:px-10 py-2 flex flex-wrap items-center justify-center gap-x-6">
          <Link href="/privacy" className={footerLinkCls}>
            {t("footer.privacy")}
          </Link>
          <Link href="/terms" className={footerLinkCls}>
            {t("footer.terms")}
          </Link>
          <Link href="/catalog" className={footerLinkCls}>
            {t("nav.catalog")}
          </Link>
          {/* Consent can be changed or withdrawn from here too (GDPR Art. 7(3)). */}
          <button
            type="button"
            onClick={openCookieSettings}
            className={`${footerLinkCls} cursor-pointer`}
          >
            {t("footer.cookieSettings")}
          </button>
        </div>
      </footer>
    </div>
  );
}
