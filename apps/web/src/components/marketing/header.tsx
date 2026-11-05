import { Link } from "@/compat/link";
import { SkipLink } from "@/components/a11y/skip-link";
import { FOCUS, PRESS } from "@/components/marketing/home/classes";
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

const BAR_CONTROL = cn(
  PRESS,
  FOCUS,
  "inline-flex h-11 cursor-pointer items-center justify-center rounded-[10px] text-[15px] font-semibold hover:bg-mk-sky-soft",
);

const ICON_BUTTON = cn(BAR_CONTROL, "w-10 min-[760px]:w-11");

// The action in the bar at every width, a little narrower below the desktop breakpoint.
const BAR_CTA =
  "h-11 max-w-60 overflow-hidden rounded-[10px] px-3.5 text-[16px] font-bold min-[1200px]:px-4";

// Sticky marketing header: a plain 64px bar on the sky, solid, with no border or shadow. Nav, language,
// mode, and one action. Its height is what the home page's stacking sheets offset from. The full nav
// only shows from 1200px, where the longest bar (Dutch, signed out) fits on one line; the page clips
// overflow, so whatever does not fit is out of reach. If that bar gets longer the breakpoint must rise,
// and every min-[1200px] class moves with it. Below it the nav folds into the burger, and below 861px
// the login link follows. The bar keeps its action next to the menu toggle at every width; on phones
// (<640px) the language and theme switches move into the menu to make room for it. Below 375px the bar
// tightens so the wordmark still fits beside the longest action, and only below 360px, under the width
// of common Android phones, does it shrink to its logo mark.
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
  const headerRef = React.useRef<HTMLElement>(null);
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

  // A press outside the header closes the menu; focus stays wherever the press
  // puts it. The language dropdown lives in a portal outside the header, and
  // while it is open the press is its to handle.
  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        headerRef.current?.contains(event.target)
      ) {
        return;
      }
      if (document.querySelector("[data-radix-popper-content-wrapper]")) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
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
    <header
      ref={headerRef}
      className="sticky top-0 z-50 bg-mk-sky text-mk-text-strong"
    >
      {/* First Tab stop on every marketing page: jumps to the page's <main>. */}
      <SkipLink />
      <div className="flex h-16 w-full items-center gap-2 px-4 max-[375px]:gap-1.5 min-[760px]:gap-5 min-[760px]:px-10">
        <Link
          href="/"
          aria-label="JigSwap"
          className={cn(PRESS, FOCUS, "min-[1200px]:mr-2")}
        >
          <Wordmark size={24} priority textClassName="max-[360px]:hidden" />
        </Link>
        <nav
          aria-label={t("primaryNav")}
          className="ml-auto hidden items-center gap-[clamp(14px,1.6vw,26px)] min-[1200px]:flex"
        >
          {NAV.map((item) => navLink(item))}
        </nav>
        <div className="ml-auto flex items-center gap-1 min-[1200px]:ml-0">
          <LangToggle className="hidden sm:inline-flex" />
          <ModeToggle className="hidden sm:inline-flex" />
          <Unauthenticated>
            <Link
              href="/sign-in"
              className={cn(
                PRESS,
                FOCUS,
                "mx-1 hidden min-h-11 items-center text-[16px] font-bold whitespace-nowrap hover:underline hover:decoration-2 hover:underline-offset-[5px] min-[861px]:inline-flex min-[1200px]:mx-1.5",
              )}
            >
              {t("login")}
            </Link>
            <Button
              className={cn(
                BAR_CTA,
                "transition-[max-width,padding,opacity,scale] duration-200 ease-mk-out",
                // Under a finger the button keeps a 44px minimum width, which would hold the room open.
                heroActionInView &&
                  "invisible max-w-0 px-0 opacity-0 pointer-coarse:min-w-0 min-[1200px]:px-0",
              )}
              asChild
            >
              <Link href="/sign-up">{t("startShelf")}</Link>
            </Button>
          </Unauthenticated>
          <Authenticated>
            <Button className={BAR_CTA} asChild>
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
            className={cn(ICON_BUTTON, "min-[1200px]:hidden")}
          >
            {open ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </div>
      {open && (
        <nav
          id="mk-mobile-nav"
          aria-label={t("menuLabel")}
          // Floats over the page: the press outside that closes it comes before the tap's
          // click is aimed, so a panel taking up room would let the page jump under the
          // finger and the click land on something else. Scrolls by itself: the sticky
          // header doesn't move with the page, so what doesn't fit below the bar could not
          // be reached otherwise.
          className="absolute inset-x-0 top-full max-h-[calc(100dvh-64px)] overflow-y-auto overscroll-contain border-b border-mk-border bg-mk-card min-[1200px]:hidden"
        >
          <div className="flex w-full flex-col px-4 pt-2 pb-4 min-[760px]:px-10">
            {NAV.map((item) => navLink(item, true))}
            {/* From 861px these sit in the bar itself. */}
            <Unauthenticated>
              <Link
                href="/sign-in"
                onClick={() => setOpen(false)}
                className={cn(
                  FOCUS,
                  "flex min-h-12 items-center text-[17px] font-semibold min-[861px]:hidden",
                )}
              >
                {t("login")}
              </Link>
              <Button
                variant="brand"
                className="mt-3 h-[50px] w-full rounded-[10px] text-[18px] font-bold min-[861px]:hidden"
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
                className="mt-3 h-[50px] w-full rounded-[10px] text-[18px] font-bold min-[861px]:hidden"
                asChild
              >
                <Link href="/dashboard" onClick={() => setOpen(false)}>
                  {t("dashboard")}
                </Link>
              </Button>
            </Authenticated>
            <div className="flex items-center gap-1 pt-3 sm:hidden">
              <LangToggle />
              <ModeToggle />
            </div>
          </div>
        </nav>
      )}
    </header>
  );
}

// Flag + code and a dropdown of the language radios (shared with the app's top bar) — switches the
// use-intl catalog via the locale cookie. With no cookie set the trigger shows the system language
// (Accept-Language negotiation in detectLocale).
export function LangToggle({ className }: { className?: string }) {
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
          className={cn(BAR_CONTROL, "gap-1.5 px-2.5", className)}
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

// Single light/dark toggle (the marketing chrome skips the "system"
// dropdown; next-themes still persists the choice app-wide).
export function ModeToggle({ className }: { className?: string }) {
  const t = useTranslations("marketing.nav");
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <button
      type="button"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      aria-label={t("toggleTheme")}
      className={cn(ICON_BUTTON, className)}
    >
      <Sun size={20} className="hidden dark:block" />
      <Moon size={20} className="dark:hidden" />
    </button>
  );
}
