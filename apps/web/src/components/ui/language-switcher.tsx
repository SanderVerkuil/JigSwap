import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Flag } from "@/components/ui/flag";
import { clearIntlCache, setLocale, type Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useRouter } from "@tanstack/react-router";
import { Globe } from "lucide-react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "use-intl";

// Each language named in its own language; render the name with `lang={code}` so screen readers
// pronounce it right. Flags come from ui/flag (inline SVGs): emoji flags render as letter pairs
// on Windows.
export const LANGUAGES = [
  { code: "en", name: "English" },
  { code: "nl", name: "Nederlands" },
] as const satisfies readonly { code: Locale; name: string }[];

export function currentLanguage(locale: string) {
  return LANGUAGES.find((language) => language.code === locale) ?? LANGUAGES[0];
}

// Rendered inside the Toaster (which sits inside the IntlProvider), so the confirmation reads in
// the language just picked rather than the one the click came from.
function LanguageChanged() {
  return useTranslations("shell.language")("changed");
}

// Switches the UI language: stores the locale cookie, drops the client-side catalog cache, then
// re-runs the root beforeLoad so the IntlProvider picks up the new catalog. Picking the current
// language again does nothing (a menu radio item fires on every select).
export function useChangeLocale() {
  const locale = useLocale();
  const router = useRouter();

  return async (next: Locale) => {
    if (next === locale) return;
    await setLocale({ data: next });
    clearIntlCache();
    await router.invalidate();
    toast.success(<LanguageChanged />);
  };
}

// The language choices as menu radios with the current one checked; shared by the app's top bar
// and the public header.
export function LanguageRadioItems() {
  const locale = useLocale();
  const changeLocale = useChangeLocale();

  return (
    <DropdownMenuRadioGroup
      value={locale}
      onValueChange={(value) => {
        const language = LANGUAGES.find(({ code }) => code === value);
        if (language) void changeLocale(language.code);
      }}
    >
      {LANGUAGES.map((language) => (
        <DropdownMenuRadioItem
          key={language.code}
          value={language.code}
          lang={language.code}
        >
          <Flag locale={language.code} />
          {language.name}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  );
}

export function LanguageSwitcher({ className }: { className?: string }) {
  const t = useTranslations("shell.language");
  const current = currentLanguage(useLocale());

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("relative", className)}
        >
          <Globe className="h-[1.2rem] w-[1.2rem]" />
          <span className="sr-only">{`${t("switch")}: ${current.name}`}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t("label")}</DropdownMenuLabel>
        <LanguageRadioItems />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
