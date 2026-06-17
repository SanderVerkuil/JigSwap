import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { clearIntlCache, type Locale, setLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useRouter } from "@tanstack/react-router";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useLocale, useTranslations } from "use-intl";

// Shared nav destinations — identical to the production marketing header so the
// retro chrome keeps the same routes.
export const RETRO_NAV = [
  { href: "/how-it-works", key: "howItWorks" },
  { href: "/features", key: "features" },
  { href: "/about", key: "about" },
  { href: "/docs", key: "docs" },
  { href: "/contact", key: "contact" },
] as const;

const LANGUAGES = [
  { code: "en", name: "English", flag: "🇺🇸" },
  { code: "nl", name: "Nederlands", flag: "🇳🇱" },
] as const satisfies readonly { code: Locale; name: string; flag: string }[];

// Language picker — square ink-bordered chip to match the printed chrome.
export function LangToggle() {
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
          className="text-mk-text-body bg-mk-card border-mk-border focus-visible:ring-mk-ring inline-flex h-11 w-11 items-center justify-center rounded-[var(--v-radius-chip)] border-2 text-[18px] leading-none focus-visible:ring-2 focus-visible:outline-none"
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

// Light/dark toggle — square chip variant.
export function ModeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <button
      type="button"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      aria-label="Toggle dark mode"
      className="text-mk-text-body bg-mk-card border-mk-border focus-visible:ring-mk-ring inline-flex h-11 w-11 items-center justify-center rounded-[var(--v-radius-chip)] border-2 focus-visible:ring-2 focus-visible:outline-none"
    >
      <Sun size={18} className="hidden dark:block" />
      <Moon size={18} className="dark:hidden" />
    </button>
  );
}
