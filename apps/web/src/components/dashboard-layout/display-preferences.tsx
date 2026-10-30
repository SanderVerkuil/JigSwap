"use client";

// Theme and language as segmented radio groups, for the places that have no top-bar menus for
// them: the phone quick sheet and the Preferences page in the account modal. Same choices and
// switching as the desktop menus (ui/theme-toggle, ui/language-switcher); 44px tall on touch
// screens.
import { Flag } from "@/components/ui/flag";
import { LANGUAGES, useChangeLocale } from "@/components/ui/language-switcher";
import { THEMES, useThemeChoice } from "@/components/ui/theme-toggle";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";
import { useLocale, useTranslations } from "use-intl";

export function ThemeRadios() {
  const t = useTranslations("shell.theme");
  const { theme, setTheme } = useThemeChoice();

  return (
    <div role="radiogroup" aria-label={t("label")} className="flex gap-2">
      {THEMES.map((choice) => (
        <Segment
          key={choice}
          selected={theme === choice}
          onSelect={() => setTheme(choice)}
        >
          {t(choice)}
        </Segment>
      ))}
    </div>
  );
}

export function LanguageRadios() {
  const t = useTranslations("shell.language");
  const locale = useLocale();
  const changeLocale = useChangeLocale();

  return (
    <div role="radiogroup" aria-label={t("label")} className="flex gap-2">
      {LANGUAGES.map((language) => (
        <Segment
          key={language.code}
          lang={language.code}
          selected={locale === language.code}
          onSelect={() => void changeLocale(language.code)}
        >
          <Flag locale={language.code} />
          {language.name}
        </Segment>
      ))}
    </div>
  );
}

// Styled like the Preferences page's content-width choice.
function Segment({
  selected,
  onSelect,
  lang,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  lang?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      lang={lang}
      onClick={onSelect}
      className={cn(
        "flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md border px-2 py-2 text-sm transition-colors pointer-coarse:min-h-11",
        selected
          ? "border-primary bg-primary/10 font-medium text-foreground"
          : "border-input text-muted-foreground hover:bg-accent hover:text-accent-foreground",
      )}
    >
      {children}
    </button>
  );
}
