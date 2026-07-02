import { Link } from "@/compat/link";
import { Wordmark } from "@/components/marketing/wordmark";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { clearIntlCache, type Locale, setLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useLocation, useRouter } from "@tanstack/react-router";
// sanctioned convex/react exception: Authenticated/Unauthenticated auth-state components (see tanstack-query migration spec)
import { Authenticated, Unauthenticated } from "convex/react";
import { Menu, Moon, Sun, X } from "lucide-react";
import { useTheme } from "next-themes";
import * as React from "react";
import { useLocale, useTranslations } from "use-intl";

const NAV = [
  { href: "/how-it-works", key: "howItWorks" },
  { href: "/features", key: "features" },
  { href: "/about", key: "about" },
  { href: "/docs", key: "docs" },
  { href: "/contact", key: "contact" },
] as const;

// Sticky marketing header: transparent over the hero, frosted card once
// scrolled. Nav + language pill + mode toggle + auth actions.
export function MarketingHeader() {
  const t = useTranslations("marketing.nav");
  const { pathname } = useLocation();
  const [scrolled, setScrolled] = React.useState(false);
  const [open, setOpen] = React.useState(false);

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
      <div className="w-full max-w-[1200px] mx-auto px-6 flex items-center gap-5 h-[70px]">
        <Link href="/" aria-label="JigSwap">
          <Wordmark />
        </Link>
        <nav className="hidden min-[861px]:flex items-center gap-[26px] ml-3.5">
          {NAV.map((item) => navLink(item))}
        </nav>
        <div className="ml-auto flex items-center gap-2.5">
          <LangToggle />
          <ModeToggle />
          <Unauthenticated>
            <Link
              href="/sign-in"
              className="hidden min-[861px]:inline-flex text-[15px] font-semibold text-mk-text-body py-1.5 px-1 hover:text-mk-violet-600 transition-colors"
            >
              {t("login")}
            </Link>
            <Button
              variant="brand"
              className="hidden min-[861px]:inline-flex"
              asChild
            >
              <Link href="/sign-up">{t("startTrading")}</Link>
            </Button>
          </Unauthenticated>
          <Authenticated>
            <Button
              variant="brand"
              className="hidden min-[861px]:inline-flex"
              asChild
            >
              <Link href="/dashboard">{t("dashboard")}</Link>
            </Button>
          </Authenticated>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-label={open ? t("closeMenu") : t("openMenu")}
            className="min-[861px]:hidden inline-flex items-center justify-center w-10 h-10 rounded-[10px] border border-mk-border bg-mk-card text-mk-text-body"
          >
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>
      {open && (
        <div className="min-[861px]:hidden border-t border-mk-border bg-mk-card">
          <div className="w-full max-w-[1200px] mx-auto flex flex-col gap-1 px-6 pt-3 pb-[18px]">
            {NAV.map((item) => navLink(item, true))}
            <Unauthenticated>
              <Link
                href="/sign-in"
                onClick={() => setOpen(false)}
                className="text-[17px] font-semibold text-mk-text-strong py-3 px-1 border-b border-mk-border"
              >
                {t("login")}
              </Link>
              <Button variant="brand" className="mt-3 w-full" asChild>
                <Link href="/sign-up" onClick={() => setOpen(false)}>
                  {t("startTrading")}
                </Link>
              </Button>
            </Unauthenticated>
            <Authenticated>
              <Button variant="brand" className="mt-3 w-full" asChild>
                <Link href="/dashboard" onClick={() => setOpen(false)}>
                  {t("dashboard")}
                </Link>
              </Button>
            </Authenticated>
          </div>
        </div>
      )}
    </header>
  );
}

const LANGUAGES = [
  { code: "en", name: "English", flag: "🇺🇸" },
  { code: "nl", name: "Nederlands", flag: "🇳🇱" },
] as const satisfies readonly { code: Locale; name: string; flag: string }[];

// Flag + dropdown — switches the use-intl catalog via the locale cookie. With
// no cookie set the trigger shows the system language (Accept-Language
// negotiation in detectLocale).
function LangToggle() {
  const t = useTranslations("marketing.nav");
  const locale = useLocale();
  const router = useRouter();
  const change = async (next: Locale) => {
    if (next === locale) return;
    await setLocale({ data: next });
    // Drop the client-side catalog cache so the invalidated root beforeLoad
    // fetches the newly selected locale.
    clearIntlCache();
    await router.invalidate();
  };
  const current =
    LANGUAGES.find((lang) => lang.code === locale) ?? LANGUAGES[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("switchLanguage")}
          className="inline-flex items-center justify-center w-10 h-10 rounded-full border border-mk-border bg-mk-card text-[18px] leading-none"
        >
          {current.flag}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {LANGUAGES.map((language) => (
          <DropdownMenuItem
            key={language.code}
            onClick={() => change(language.code)}
            className={cn(locale === language.code && "bg-accent")}
          >
            <span className="mr-2">{language.flag}</span>
            {language.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Single round light/dark toggle (the marketing chrome skips the "system"
// dropdown; next-themes still persists the choice app-wide).
function ModeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <button
      type="button"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      aria-label="Toggle dark mode"
      className="inline-flex items-center justify-center w-10 h-10 rounded-full border border-mk-border bg-mk-card text-mk-text-body"
    >
      <Sun size={18} className="hidden dark:block" />
      <Moon size={18} className="dark:hidden" />
    </button>
  );
}
