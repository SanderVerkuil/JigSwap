import { Link } from "@/compat/link";
import { LangToggle, ModeToggle } from "@/components/marketing/header";
import { Wordmark } from "@/components/marketing/wordmark";
import type * as React from "react";
import { useTranslations } from "use-intl";

const footerLinkCls =
  "inline-flex min-h-10 items-center text-[13.5px] text-mk-text-muted hover:text-mk-violet-600 transition-colors";

// Brand frame for the Clerk sign-in / sign-up cards: a slim bar with the
// wordmark (the way back home) and the language + theme switches, the card in
// the page's <main>, and a footer with the legal pages and the public
// catalogue. Deliberately lighter than the marketing header: no nav and no
// sign-up CTA competing with the form. The marketing font is set on the bar
// and footer only, so the Clerk card keeps the app font it shares with the
// in-app Clerk UI. On phones the card sits near the top, clear of the
// on-screen keyboard; from sm up it is centred.
export function AuthShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations("marketing");
  return (
    <div className="mk-root min-h-svh flex flex-col overflow-x-clip">
      <header className="font-mk-sans w-full max-w-[1200px] mx-auto px-4 sm:px-6 h-16 flex items-center gap-3">
        <Link href="/" aria-label="JigSwap">
          <Wordmark />
        </Link>
        <div className="ml-auto flex items-center gap-2.5">
          <LangToggle />
          <ModeToggle />
        </div>
      </header>
      <main className="flex-1 flex items-start sm:items-center justify-center px-4 py-4 sm:py-10">
        <div className="w-full max-w-md">{children}</div>
      </main>
      <footer className="font-mk-sans border-t border-mk-border">
        <div className="w-full max-w-[1200px] mx-auto px-4 sm:px-6 py-2 flex flex-wrap items-center justify-center gap-x-6">
          <Link href="/privacy" className={footerLinkCls}>
            {t("footer.privacy")}
          </Link>
          <Link href="/terms" className={footerLinkCls}>
            {t("footer.terms")}
          </Link>
          <Link href="/catalog" className={footerLinkCls}>
            {t("nav.catalog")}
          </Link>
        </div>
      </footer>
    </div>
  );
}
