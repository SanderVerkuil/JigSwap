import { Link } from "@/compat/link";
import { Wordmark } from "@/components/marketing/wordmark";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Flag } from "@/components/ui/flag";
import {
  currentLanguage,
  LanguageRadioItems,
} from "@/components/ui/language-switcher";
import { cn } from "@/lib/utils";
import { useLocation } from "@tanstack/react-router";
// sanctioned convex/react exception: Authenticated/Unauthenticated auth-state components (see tanstack-query migration spec)
import { Authenticated, Unauthenticated } from "convex/react";
import { Menu, Moon, Sun, X } from "lucide-react";
import { useTheme } from "next-themes";
import * as React from "react";
import { useLocale, useTranslations } from "use-intl";

const NAV = [
  { href: "/how-it-works", key: "howItWorks" },
  { href: "/catalog", key: "catalog" },
  { href: "/features", key: "features" },
  { href: "/about", key: "about" },
  { href: "/docs", key: "docs" },
  { href: "/contact", key: "contact" },
] as const;

// Brand CTA in the bar at every width: compact (40px tall) below the 861px
// desktop breakpoint, the regular button size above it.
const BAR_CTA = "h-10 px-3.5 min-[861px]:h-9 min-[861px]:px-4";

// Sticky marketing header: transparent over the hero, frosted card once
// scrolled. Nav + language pill + mode toggle + auth actions. The full bar needs
// about 1,185px in Dutch (the page clips overflow, so whatever does not fit is
// out of reach): below 1200px the nav folds into the burger, and below 861px the
// login link follows it. The bar keeps the brand CTA next to the menu toggle at
// every width; on phones (<640px) the language and theme switches move into the
// menu to make room for it, and below 375px the wordmark shrinks to its logo mark.
export function MarketingHeader() {
  const t = useTranslations("marketing.nav");
  const { pathname } = useLocation();
  const [scrolled, setScrolled] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const toggleRef = React.useRef<HTMLButtonElement>(null);

  // Escape closes the open menu and hands focus back to its toggle. An Escape
  // another layer already consumed (e.g. the language dropdown inside the
  // menu) is left alone.
  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      setOpen(false);
      toggleRef.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const navLink = (item: (typeof NAV)[number], mobile = false) => (
    <Link
      key={item.href}
      href={item.href}
      onClick={() => setOpen(false)}
      className={cn(
        mobile
          ? "text-[17px] font-semibold text-mk-text-strong py-3 px-1 border-b border-mk-border"
          : "text-[15px] font-medium py-1.5 hover:text-mk-violet-600 transition-colors",
        !mobile &&
          (pathname === item.href ? "text-mk-violet-600" : "text-mk-text-body"),
      )}
    >
      {t(item.key)}
    </Link>
  );

  return (
    <header
      className={cn(
        "sticky top-0 z-50 transition-[background-color,border-color] duration-250",
        "border-b",
        scrolled
          ? "bg-[color-mix(in_oklab,var(--mk-card)_86%,transparent)] backdrop-blur-md backdrop-saturate-150 border-mk-border"
          : "bg-transparent border-transparent",
      )}
    >
      <div className="w-full max-w-[1200px] mx-auto px-6 flex items-center gap-3 sm:gap-5 h-[70px]">
        <Link href="/" aria-label="JigSwap">
          <Wordmark textClassName="max-[375px]:hidden" />
        </Link>
        <nav className="hidden min-[1200px]:flex items-center gap-4 ml-2">
          {NAV.map((item) => navLink(item))}
        </nav>
        <div className="ml-auto flex items-center gap-2.5">
          <LangToggle className="hidden sm:inline-flex" />
          <ModeToggle className="hidden sm:inline-flex" />
          <Unauthenticated>
            <Link
              href="/sign-in"
              className="hidden min-[861px]:inline-flex text-[15px] font-semibold text-mk-text-body py-1.5 px-1 hover:text-mk-violet-600 transition-colors"
            >
              {t("login")}
            </Link>
            <Button variant="brand" className={BAR_CTA} asChild>
              <Link href="/sign-up">{t("startTrading")}</Link>
            </Button>
          </Unauthenticated>
          <Authenticated>
            <Button variant="brand" className={BAR_CTA} asChild>
              <Link href="/dashboard">{t("dashboard")}</Link>
            </Button>
          </Authenticated>
          <button
            ref={toggleRef}
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-label={open ? t("closeMenu") : t("openMenu")}
            aria-expanded={open}
            aria-controls="mk-mobile-nav"
            className="min-[1200px]:hidden inline-flex items-center justify-center w-10 h-10 rounded-[10px] border border-mk-border bg-mk-card text-mk-text-body"
          >
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>
      {open && (
        <nav
          id="mk-mobile-nav"
          aria-label={t("menuLabel")}
          className="min-[1200px]:hidden border-t border-mk-border bg-mk-card"
        >
          <div className="w-full max-w-[1200px] mx-auto flex flex-col gap-1 px-6 pt-3 pb-[18px]">
            {NAV.map((item) => navLink(item, true))}
            {/* From 861px these sit in the bar itself. */}
            <Unauthenticated>
              <Link
                href="/sign-in"
                onClick={() => setOpen(false)}
                className="min-[861px]:hidden text-[17px] font-semibold text-mk-text-strong py-3 px-1 border-b border-mk-border"
              >
                {t("login")}
              </Link>
              <Button
                variant="brand"
                className="min-[861px]:hidden mt-3 w-full h-11"
                asChild
              >
                <Link href="/sign-up" onClick={() => setOpen(false)}>
                  {t("startTrading")}
                </Link>
              </Button>
            </Unauthenticated>
            <Authenticated>
              <Button
                variant="brand"
                className="min-[861px]:hidden mt-3 w-full h-11"
                asChild
              >
                <Link href="/dashboard" onClick={() => setOpen(false)}>
                  {t("dashboard")}
                </Link>
              </Button>
            </Authenticated>
            <div className="sm:hidden flex items-center gap-2.5 pt-4">
              <LangToggle />
              <ModeToggle />
            </div>
          </div>
        </nav>
      )}
    </header>
  );
}

// Flag + code pill and a dropdown of the language radios (shared with the app's
// top bar) — switches the use-intl catalog via the locale cookie. With no
// cookie set the trigger shows the system language (Accept-Language
// negotiation in detectLocale).
function LangToggle({ className }: { className?: string }) {
  const t = useTranslations("marketing.nav");
  const current = currentLanguage(useLocale());
  const code = current.code.toUpperCase();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          // Names the visible code too, so voice control can target what it sees (WCAG 2.5.3).
          aria-label={`${t("switchLanguage")}: ${current.name}, ${code}`}
          className={cn(
            "inline-flex items-center justify-center gap-1.5 h-10 px-3 rounded-full border border-mk-border bg-mk-card text-[13px] font-semibold leading-none text-mk-text-body",
            className,
          )}
        >
          <Flag locale={current.code} />
          {code}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <LanguageRadioItems />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Single round light/dark toggle (the marketing chrome skips the "system"
// dropdown; next-themes still persists the choice app-wide).
function ModeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <button
      type="button"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      aria-label="Toggle dark mode"
      className={cn(
        "inline-flex items-center justify-center w-10 h-10 rounded-full border border-mk-border bg-mk-card text-mk-text-body",
        className,
      )}
    >
      <Sun size={18} className="hidden dark:block" />
      <Moon size={18} className="dark:hidden" />
    </button>
  );
}
