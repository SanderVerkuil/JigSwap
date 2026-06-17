import { Link } from "@/compat/link";
import { Wordmark } from "@/components/marketing/wordmark";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useLocation } from "@tanstack/react-router";
import { Authenticated, Unauthenticated } from "convex/react";
import { Menu, X } from "lucide-react";
import * as React from "react";
import { useTranslations } from "use-intl";
import { LangToggle, ModeToggle, RETRO_NAV } from "./chrome";

// Retro header — a printed "box top edge" strip. Same NAV destinations, auth
// actions, and theme/lang toggles as the production header; bottom border reads
// as a die-cut box edge (double rule).
export function RetroHeader() {
  const t = useTranslations("marketing.nav");
  const { pathname } = useLocation();
  const [open, setOpen] = React.useState(false);

  const navLink = (item: (typeof RETRO_NAV)[number], mobile = false) => (
    <Link
      key={item.href}
      href={item.href}
      onClick={() => setOpen(false)}
      className={cn(
        "focus-visible:ring-mk-ring rounded-[4px] focus-visible:ring-2 focus-visible:outline-none",
        mobile
          ? "text-mk-text-strong border-mk-border border-b px-1 py-3 text-[17px] font-semibold"
          : "hover:text-mk-violet-600 py-1.5 text-[15px] font-semibold tracking-tight transition-colors",
        !mobile &&
          (pathname === item.href ? "text-mk-violet-600" : "text-mk-text-body"),
      )}
    >
      {t(item.key)}
    </Link>
  );

  return (
    <header className="paper v-double-rule sticky top-0 z-50">
      <div className="mx-auto flex h-[70px] w-full max-w-[1200px] items-center gap-4 px-6">
        <Link
          href="/"
          aria-label="JigSwap"
          className="focus-visible:ring-mk-ring rounded-[6px] focus-visible:ring-2 focus-visible:outline-none"
        >
          <Wordmark />
        </Link>

        <span
          aria-hidden="true"
          className="text-mk-text-muted border-mk-border mx-2 hidden border-l-2 pl-4 font-mono text-[10.5px] font-semibold tracking-[0.16em] uppercase min-[1040px]:inline"
        >
          Est. 2025 · Dutch Kitchen Table
        </span>

        <nav className="ml-2 hidden items-center gap-[22px] min-[861px]:flex">
          {RETRO_NAV.map((item) => navLink(item))}
        </nav>

        <div className="ml-auto flex items-center gap-2.5">
          <LangToggle />
          <ModeToggle />
          <Unauthenticated>
            <Link
              href="/sign-in"
              className="text-mk-text-body hover:text-mk-violet-600 focus-visible:ring-mk-ring hidden rounded-[4px] px-1 py-1.5 text-[15px] font-semibold transition-colors focus-visible:ring-2 focus-visible:outline-none min-[861px]:inline-flex"
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
            aria-expanded={open}
            className="text-mk-text-body bg-mk-card border-mk-border focus-visible:ring-mk-ring inline-flex h-11 w-11 items-center justify-center rounded-[var(--v-radius-chip)] border-2 focus-visible:ring-2 focus-visible:outline-none min-[861px]:hidden"
          >
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {open && (
        <div className="paper border-mk-border border-t min-[861px]:hidden">
          <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-1 px-6 pt-3 pb-[18px]">
            {RETRO_NAV.map((item) => navLink(item, true))}
            <Unauthenticated>
              <Link
                href="/sign-in"
                onClick={() => setOpen(false)}
                className="text-mk-text-strong border-mk-border border-b px-1 py-3 text-[17px] font-semibold"
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
