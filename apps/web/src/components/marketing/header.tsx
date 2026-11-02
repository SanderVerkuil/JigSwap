import { Link } from "@/compat/link";
import { FOCUS, PRESS } from "@/components/marketing/home/classes";
import { Wordmark } from "@/components/marketing/wordmark";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { clearIntlCache, setLocale, type Locale } from "@/lib/i18n";
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
  { href: "/catalog", key: "catalog" },
  { href: "/features", key: "features" },
  { href: "/about", key: "about" },
  { href: "/docs", key: "docs" },
  { href: "/contact", key: "contact" },
] as const;

const ICON_BUTTON = cn(
  PRESS,
  FOCUS,
  "inline-flex h-11 w-10 cursor-pointer items-center justify-center rounded-[10px] text-[15px] font-semibold hover:bg-mk-sky-soft min-[760px]:w-11",
);

// Sticky marketing header: a plain 64px bar on the sky, solid, with no border or shadow. Nav, language,
// mode, and one action. Its height is what the home page's stacking sheets offset from.
export function MarketingHeader({
  hideActionNearHero = false,
}: {
  // The home hero has the same action in marigold; the header's stays away until that one has gone.
  hideActionNearHero?: boolean;
}) {
  const t = useTranslations("marketing.nav");
  const [heroActionInView, setHeroActionInView] =
    React.useState(hideActionNearHero);

  React.useEffect(() => {
    if (!hideActionNearHero) return;
    const action = document.querySelector("[data-hero-action]");
    if (!action) return;
    const observer = new IntersectionObserver(
      ([entry]) => setHeroActionInView(entry.isIntersecting),
      { rootMargin: "-64px 0px 0px 0px" },
    );
    observer.observe(action);
    return () => observer.disconnect();
  }, [hideActionNearHero]);
  const { pathname } = useLocation();
  const [open, setOpen] = React.useState(false);
  const menuButton = React.useRef<HTMLButtonElement>(null);

  // Escape closes the phone menu and hands focus back to the button that opened it.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        menuButton.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const navLink = (item: (typeof NAV)[number], mobile = false) => (
    <Link
      key={item.href}
      href={item.href}
      onClick={() => setOpen(false)}
      aria-current={pathname === item.href ? "page" : undefined}
      className={cn(
        FOCUS,
        mobile
          ? "flex min-h-12 items-center text-[17px] font-semibold"
          : cn(
              PRESS,
              "inline-flex min-h-11 items-center text-[16px] whitespace-nowrap hover:underline hover:decoration-2 hover:underline-offset-[5px]",
              pathname === item.href &&
                "underline decoration-2 underline-offset-[5px]",
            ),
      )}
    >
      {t(item.key)}
    </Link>
  );

  return (
    <header className="sticky top-0 z-50 bg-mk-sky text-mk-text-strong">
      <div className="flex h-16 w-full items-center gap-2 px-4 min-[760px]:gap-5 min-[760px]:px-10">
        <Link
          href="/"
          aria-label="JigSwap"
          className={cn(PRESS, FOCUS, "min-[1180px]:mr-2")}
        >
          <Wordmark size={24} />
        </Link>
        <nav
          aria-label={t("mainNav")}
          className="ml-auto hidden items-center gap-[clamp(14px,1.6vw,26px)] min-[1180px]:flex"
        >
          {NAV.map((item) => navLink(item))}
        </nav>
        <div className="ml-auto flex items-center gap-1 min-[1180px]:ml-0">
          <LangToggle />
          <ModeToggle />
          <Unauthenticated>
            <Link
              href="/sign-in"
              className={cn(
                PRESS,
                FOCUS,
                "mx-1 hidden min-h-11 items-center text-[16px] font-bold whitespace-nowrap hover:underline hover:decoration-2 hover:underline-offset-[5px] min-[380px]:inline-flex min-[1180px]:mx-1.5",
              )}
            >
              {t("login")}
            </Link>
            <Button
              className={cn(
                "hidden h-11 max-w-60 overflow-hidden rounded-[10px] px-4 text-[16px] font-bold transition-[max-width,padding,opacity,scale] duration-200 ease-mk-out min-[1180px]:inline-flex",
                heroActionInView && "invisible max-w-0 px-0 opacity-0",
              )}
              asChild
            >
              <Link href="/sign-up">{t("startShelf")}</Link>
            </Button>
          </Unauthenticated>
          <Authenticated>
            <Button
              className="hidden h-11 rounded-[10px] px-4 text-[16px] font-bold min-[1180px]:inline-flex"
              asChild
            >
              <Link href="/dashboard">{t("dashboard")}</Link>
            </Button>
          </Authenticated>
          <button
            ref={menuButton}
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-label={open ? t("closeMenu") : t("openMenu")}
            aria-expanded={open}
            aria-controls="marketing-menu"
            className={cn(ICON_BUTTON, "min-[1180px]:hidden")}
          >
            {open ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </div>
      {open && (
        <div id="marketing-menu" className="bg-mk-card min-[1180px]:hidden">
          <div className="flex w-full flex-col px-4 pt-2 pb-4 min-[760px]:px-10">
            {NAV.map((item) => navLink(item, true))}
            <Unauthenticated>
              <Link
                href="/sign-in"
                onClick={() => setOpen(false)}
                className={cn(
                  FOCUS,
                  "flex min-h-12 items-center text-[17px] font-semibold",
                )}
              >
                {t("login")}
              </Link>
              <Button
                variant="brand"
                className="mt-3 h-[50px] w-full rounded-[10px] text-[18px] font-bold"
                asChild
              >
                <Link href="/sign-up" onClick={() => setOpen(false)}>
                  {t("startShelf")}
                </Link>
              </Button>
            </Unauthenticated>
            <Authenticated>
              <Button
                variant="brand"
                className="mt-3 h-[50px] w-full rounded-[10px] text-[18px] font-bold"
                asChild
              >
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
  { code: "en", name: "English", short: "EN" },
  { code: "nl", name: "Nederlands", short: "NL" },
] as const satisfies readonly { code: Locale; name: string; short: string }[];

// Language code + dropdown — switches the use-intl catalog via the locale cookie. With no cookie set
// the trigger shows the system language (Accept-Language negotiation in detectLocale).
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
          className={ICON_BUTTON}
        >
          {current.short}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {LANGUAGES.map((language) => (
          <DropdownMenuItem
            key={language.code}
            onClick={() => change(language.code)}
            className={cn(locale === language.code && "bg-accent")}
          >
            {language.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Single light/dark toggle (the marketing chrome skips the "system"
// dropdown; next-themes still persists the choice app-wide).
function ModeToggle() {
  const t = useTranslations("marketing.nav");
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <button
      type="button"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      aria-label={t("toggleTheme")}
      className={ICON_BUTTON}
    >
      <Sun size={20} className="hidden dark:block" />
      <Moon size={20} className="dark:hidden" />
    </button>
  );
}
