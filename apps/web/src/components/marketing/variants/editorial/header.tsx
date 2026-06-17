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
import { Authenticated, Unauthenticated } from "convex/react";
import { Menu, Moon, Sun, X } from "lucide-react";
import { useTheme } from "next-themes";
import * as React from "react";
import { useLocale, useTranslations } from "use-intl";

// Editorial masthead header (rebuilt from MarketingHeader). Two-row magazine
// masthead: an "issue rule" over the nameplate. Keeps the same NAV
// destinations, auth Buttons, ModeToggle + LangToggle, and the semantic
// <header> landmark. Re-skins via --mk-* under .v-editorial like everything else.

const NAV = [
  { href: "/how-it-works", key: "howItWorks" },
  { href: "/features", key: "features" },
  { href: "/about", key: "about" },
  { href: "/docs", key: "docs" },
  { href: "/contact", key: "contact" },
] as const;

export function EditorialHeader() {
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
          : "text-[14px] font-medium tracking-tight py-1.5 transition-colors hover:text-mk-text-strong",
        !mobile &&
          (pathname === item.href
            ? "text-mk-text-strong"
            : "text-mk-text-body"),
      )}
    >
      {t(item.key)}
    </Link>
  );

  return (
    <header
      className={cn(
        "sticky top-0 z-50 transition-[background-color,border-color] duration-250 border-b",
        scrolled
          ? "bg-[color-mix(in_oklab,var(--mk-card)_90%,transparent)] backdrop-blur-md border-mk-border"
          : "bg-transparent border-transparent",
      )}
    >
      {/* Row 1 — the masthead rule (desktop) */}
      <div className="hidden min-[861px]:block border-b border-mk-border">
        <div className="w-full max-w-[1200px] mx-auto px-6 h-[34px] flex items-center justify-between ed-mono text-[11px] tracking-[0.18em] uppercase text-mk-text-muted">
          <span>EST. 2025</span>
          <span className="text-mk-text-body">
            MADE AT A DUTCH KITCHEN TABLE
          </span>
          <span>NETHERLANDS</span>
        </div>
      </div>
      {/* Row 1 — compact rule (mobile) */}
      <div className="min-[861px]:hidden border-b border-mk-border">
        <div className="w-full max-w-[1200px] mx-auto px-6 h-[26px] flex items-center ed-mono text-[10px] tracking-[0.18em] uppercase text-mk-text-muted">
          EST. 2025 · NL
        </div>
      </div>

      {/* Row 2 — the nameplate */}
      <div className="w-full max-w-[1200px] mx-auto px-6 flex items-center gap-5 h-16 border-b border-mk-border">
        <Link href="/" aria-label="JigSwap">
          <Wordmark size={26} />
        </Link>
        <nav className="hidden min-[861px]:flex items-center gap-[26px] ml-auto">
          {NAV.map((item) => navLink(item))}
        </nav>
        <div className="hidden min-[861px]:flex items-center gap-2.5">
          <LangToggle />
          <ModeToggle />
          <Unauthenticated>
            <Link
              href="/sign-in"
              className="text-[14px] font-semibold text-mk-text-body py-1.5 px-1 transition-colors hover:text-mk-text-strong"
            >
              {t("login")}
            </Link>
            <Button variant="brand" asChild>
              <Link href="/sign-up">{t("startTrading")}</Link>
            </Button>
          </Unauthenticated>
          <Authenticated>
            <Button variant="brand" asChild>
              <Link href="/dashboard">{t("dashboard")}</Link>
            </Button>
          </Authenticated>
        </div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? t("closeMenu") : t("openMenu")}
          aria-expanded={open}
          className="min-[861px]:hidden ml-auto inline-flex items-center justify-center w-11 h-11 rounded-[4px] border border-mk-border bg-mk-card text-mk-text-body"
        >
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* Mobile sheet */}
      {open && (
        <div className="min-[861px]:hidden border-b border-mk-border bg-mk-card">
          <div className="w-full max-w-[1200px] mx-auto flex flex-col gap-1 px-6 pt-3 pb-[18px]">
            <div className="flex items-center gap-2.5 pb-3 mb-1 border-b border-mk-border">
              <LangToggle />
              <ModeToggle />
            </div>
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

function LangToggle() {
  const t = useTranslations("marketing.nav");
  const locale = useLocale();
  const router = useRouter();
  const change = async (next: Locale) => {
    if (next === locale) return;
    await setLocale({ data: next });
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
          className="inline-flex items-center justify-center w-11 h-11 rounded-[4px] border border-mk-border bg-mk-card text-[18px] leading-none"
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

function ModeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <button
      type="button"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      aria-label="Toggle dark mode"
      className="inline-flex items-center justify-center w-11 h-11 rounded-[4px] border border-mk-border bg-mk-card text-mk-text-body"
    >
      <Sun size={18} className="hidden dark:block" />
      <Moon size={18} className="dark:hidden" />
    </button>
  );
}
